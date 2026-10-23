import type { Prisma, ScheduleStatus } from '@prisma/client';
import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { toRevertLocationDto } from '@/app/lib/revert-location';
import { assertBranchNotLocked, parseKolkataAttendanceDateYmd, getKolkataDayEndExclusiveUtc, getKolkataCalendarYmd } from '@/app/lib/branch-lock';
import { allocateTransactionLinesFromComponentBudgets } from '@/app/lib/loan-transaction-lines';
import { isGoldLoanProduct } from '@/app/lib/gl-config';
import { determineWorkbenchMode } from '@/app/lib/collections/workbench-mode';
import { computeOutstandingForForeclosure, FORECLOSURE_MONEY_TOLERANCE } from '@/app/lib/foreclosure-workflow';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { claimPendingTransaction, CollectionAlreadyProcessedError } from '@/app/lib/collections/claim-pending-transaction';
import { bumpLoanBalance } from '@/app/lib/cache/loan-balance-cache';

/** Prisma interactive tx defaults (~5s) are too low for batches with many lines → P2028. */
const COLLECTION_APPROVE_TX_TIMEOUT_MS = 60_000;
const COLLECTION_APPROVE_TX_MAX_WAIT_MS = 15_000;

type ScheduleApplyRow = {
    id: string;
    principalPaid: number;
    interestPaid: number;
    feesPaid: number;
    penaltiesPaid: number;
    principalDue: number;
    interestDue: number;
    feesDue: number;
    penaltiesDue: number;
    status: ScheduleStatus;
    paidAt: Date | null;
};

// Helper function to determine collection type (legacy badge — kept for UI backward-compat)
function determineCollectionType(schedules: Array<{ dueDate: string | null }>): 'ADVANCE' | 'ARREAR' | 'MIXED' {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let hasAdvance = false;
    let hasArrear = false;

    for (const schedule of schedules) {
        if (schedule.dueDate) {
            const dueDate = new Date(schedule.dueDate);
            dueDate.setHours(0, 0, 0, 0);

            if (dueDate > today) {
                hasAdvance = true;
            } else if (dueDate < today) {
                hasArrear = true;
            }
        }
    }

    if (hasAdvance && hasArrear) return 'MIXED';
    if (hasAdvance) return 'ADVANCE';
    return 'ARREAR';
}

/**
 * Auto-closes a loan whose final due was just approved: all schedules PAID and zero
 * outstanding principal/interest (reuses the same calc as foreclosure). No-op if the
 * loan isn't fully settled yet or is already closed. Must run inside the caller's
 * collection-approval transaction so a mid-batch failure rolls the closure back too.
 */
async function closeLoanIfFullyPaid(tx: Prisma.TransactionClient, loanId: string, transactionDate: Date): Promise<void> {
    const loan = await tx.loan.findUnique({
        where: { id: loanId },
        select: {
            amount: true,
            principalPaid: true,
            isActive: true,
            schedules: {
                select: {
                    status: true,
                    principalDue: true,
                    principalPaid: true,
                    interestDue: true,
                    interestPaid: true,
                    penaltiesDue: true,
                    penaltiesPaid: true,
                    dueDate: true,
                },
            },
        },
    });

    if (!loan || !loan.isActive || loan.schedules.length === 0) return;
    if (!loan.schedules.every((s) => s.status === 'PAID')) return;

    const outstanding = computeOutstandingForForeclosure({
        loanAmount: Number(loan.amount),
        principalPaid: Number(loan.principalPaid),
        schedules: loan.schedules.map((s) => ({
            status: s.status,
            principalDue: Number(s.principalDue),
            principalPaid: Number(s.principalPaid),
            interestDue: Number(s.interestDue),
            interestPaid: Number(s.interestPaid),
            penaltiesDue: Number(s.penaltiesDue),
            penaltiesPaid: Number(s.penaltiesPaid),
            dueDate: s.dueDate,
        })),
    });

    if (outstanding.osPrincipal > FORECLOSURE_MONEY_TOLERANCE || outstanding.osInterest > FORECLOSURE_MONEY_TOLERANCE) {
        return;
    }

    await tx.loan.update({
        where: { id: loanId },
        data: {
            disbursementStatus: 'CLOSED',
            isActive: false,
            closedDate: transactionDate,
        },
    });
}

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/collections/approve
 * Fetch pending collections for approval
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const requestedBranchId = searchParams.get('branchId');
            // Any branch the user is permitted to see — their assigned set
            // (UserBranchAssignment / AreaManagerBranch), not just their primary.
            const permittedBranchIds = await getPermittedBranchIds(user);
            let branchId: string | null = requestedBranchId || user.branchId || null;
            if (permittedBranchIds !== null) {
                if (branchId && !permittedBranchIds.includes(branchId)) {
                    return errorResponse('You do not have access to that branch', 403);
                }
                if (!branchId) {
                    branchId = permittedBranchIds[0] ?? null;
                }
            }
            if (!branchId) {
                return errorResponse('Branch context is required for collection approval queue', 400);
            }
            const centerId = searchParams.get('centerId') || undefined;
            const collectedById = searchParams.get('collectedById') || undefined;
            const dateYmd = searchParams.get('date') || undefined;
            // 'PENDING' (default) = the approval queue; 'APPROVED' = the revert workbench
            // feed (already-approved, not-yet-reversed collections eligible to undo); 'ALL' =
            // the approval page's own tabs (Demand/Advance/Arrear/Gold) — once approved, a row
            // must keep showing (with its own status) instead of disappearing, so the tabs read
            // as a running history for the day rather than a queue that empties out from under you.
            // 'REVERTED' = the Collection Revert page's "Show Reverted Collections" history view —
            // a reverted transaction's own `status` stays APPROVED forever, only `isReversed`
            // distinguishes it, so this behaves like APPROVED below except for the isReversed flip.
            const statusParam = searchParams.get('status');
            const statusFilter: 'PENDING' | 'APPROVED' | { in: ('PENDING' | 'APPROVED')[] } =
                statusParam === 'APPROVED' || statusParam === 'REVERTED'
                    ? 'APPROVED'
                    : statusParam === 'ALL' ? { in: ['PENDING', 'APPROVED'] } : 'PENDING';

            let dateRange: { gte: Date; lt: Date } | undefined;
            if (dateYmd) {
                const dayStartUtc = parseKolkataAttendanceDateYmd(dateYmd);
                dateRange = { gte: dayStartUtc, lt: getKolkataDayEndExclusiveUtc(dayStartUtc) };
            }

            const branchLock = await prisma.branchLock.findUnique({
                where: { branchId },
                select: { currentWorkingDate: true },
            });

            // Fetch ALL pending/approved transactions (REPAYMENT + SAVINGS_COLLECTION) for this branch,
            // regardless of the collecting user's role — ADMIN/BRANCH_MANAGER/AREA_MANAGER can submit
            // collections directly (not just FDO), and those batches still need to show up here.
            const pendingTransactions = await prisma.loanTransaction.findMany({
                where: {
                    status: statusFilter as never,
                    collectionBatchId: { not: null },
                    branchId,
                    // PENDING/APPROVED/ALL must exclude reverted rows so a reverted collection
                    // doesn't linger; REVERTED is the one mode that wants only reverted rows.
                    isReversed: statusParam === 'REVERTED',
                    ...(centerId ? { centerId } : {}),
                    ...(collectedById ? { collectedById } : {}),
                    ...(dateRange ? { transactionDate: dateRange } : {}),
                },
                include: {
                    collectedBy: {
                        select: { id: true, firstName: true, lastName: true, role: true }
                    },
                    revertedBy: {
                        select: { firstName: true, lastName: true, employeeId: true }
                    },
                    center: {
                        select: { name: true, code: true }
                    },
                    client: {
                        select: { firstName: true, lastName: true, clientId: true }
                    },
                    loan: {
                        select: {
                            loanNumber: true,
                            amount: true,
                            funder: { select: { funderName: true } },
                            loanProduct: { select: { productName: true, numberOfDues: true, loanProductType: { select: { name: true } } } },
                        }
                    },
                    lines: {
                        include: {
                            schedule: {
                                select: {
                                    id: true,
                                    installmentNo: true,
                                    dueDate: true,
                                    principalDue: true,
                                    interestDue: true,
                                    feesDue: true,
                                    penaltiesDue: true,
                                    savingsDue: true,
                                    status: true
                                }
                            }
                        }
                    }
                },
                orderBy: { createdAt: 'desc' }
            });

            // Separate SAVINGS_COLLECTION from REPAYMENT transactions
            // Build a map: batchId+loanId -> savingsAmount
            const savingsByBatchLoan = new Map<string, number>();
            for (const tx of pendingTransactions) {
                if ((tx.type as string) === 'SAVINGS_COLLECTION' && tx.collectionBatchId) {
                    const key = `${tx.collectionBatchId}:${tx.loanId}`;
                    savingsByBatchLoan.set(key, (savingsByBatchLoan.get(key) ?? 0) + Number(tx.amount || 0));
                }
            }

            // Flatten each REPAYMENT transaction into one workbench row (SAVINGS_COLLECTION
            // rows are merged in as loanAdvanceAmount on their matching REPAYMENT row).
            const rows: Array<{
                transactionId: string;
                batchId: string | null;
                clientId: string;
                clientCode: string;
                clientName: string;
                loanNumber: string;
                productName: string;
                funderName: string;
                isGoldLoan: boolean;
                centerName: string;
                centerCode: string;
                collectedByName: string;
                collectedById: string;
                dueCount: string;
                dueDate: string | null;
                collectionDate: string;
                status: string;
                mode: 'DEMAND' | 'ADVANCE' | 'ARREAR' | 'LOAN_ADVANCE';
                collectionType: 'ADVANCE' | 'ARREAR' | 'MIXED';
                loanAmount: number;
                principalAmount: number;
                interestAmount: number;
                totalAmount: number;
                loanAdvanceAmount: number;
                walletAdvance: number;
                walletPay: number;
                thrift1: number;
                thrift2: number;
                remarks: string | null;
                isEodLocked: boolean;
                isAllocationLocked: boolean;
                isReversed: boolean;
                revertedAt: string | null;
                revertedByName: string | null;
                revertedByEmployeeId: string | null;
                revertReason: string | null;
                revertLocation: { latitude: number; longitude: number } | null;
            }> = [];

            // Tracks which batchId+loanId pairs got a REPAYMENT row below, so a
            // loan-advance-only submission (no REPAYMENT — amount was 0) can still
            // be surfaced as its own row instead of silently vanishing.
            const repaymentRowKeys = new Set<string>();

            for (const tx of pendingTransactions) {
                // Skip SAVINGS_COLLECTION — merged into their REPAYMENT row's loanAdvanceAmount below
                if ((tx.type as string) === 'SAVINGS_COLLECTION') continue;

                if (tx.collectionBatchId) {
                    repaymentRowKeys.add(`${tx.collectionBatchId}:${tx.loanId}`);
                }

                const scheduleLines = tx.lines.map(line => ({
                    dueDate: line.schedule?.dueDate ? new Date(line.schedule.dueDate).toISOString() : null,
                }));

                const collectionType = determineCollectionType(scheduleLines);
                const mode = determineWorkbenchMode(scheduleLines, tx.transactionDate);
                const savingsAmount = tx.collectionBatchId
                    ? savingsByBatchLoan.get(`${tx.collectionBatchId}:${tx.loanId}`) ?? 0
                    : 0;
                const firstLine = tx.lines[0];
                const totalDues = tx.loan?.loanProduct?.numberOfDues;

                rows.push({
                    transactionId: tx.id,
                    batchId: tx.collectionBatchId,
                    clientId: tx.clientId,
                    clientCode: tx.client?.clientId || 'N/A',
                    clientName: tx.client ? `${tx.client.firstName} ${tx.client.lastName}` : 'Unknown Client',
                    loanNumber: tx.loan?.loanNumber || 'N/A',
                    productName: tx.loan?.loanProduct?.productName || 'N/A',
                    funderName: tx.loan?.funder?.funderName || 'own fund',
                    isGoldLoan: isGoldLoanProduct(tx.loan?.loanProduct?.loanProductType?.name),
                    centerName: tx.center?.name || 'Manual',
                    centerCode: tx.center?.code || '',
                    collectedByName: tx.collectedBy ? `${tx.collectedBy.firstName} ${tx.collectedBy.lastName}` : 'System',
                    collectedById: tx.collectedBy?.id || '',
                    dueCount: firstLine ? `${firstLine.installmentNo}${totalDues ? ` / ${totalDues}` : ''}` : '?',
                    dueDate: firstLine?.schedule?.dueDate ? new Date(firstLine.schedule.dueDate).toISOString() : null,
                    collectionDate: tx.transactionDate.toISOString(),
                    status: tx.status as string,
                    mode,
                    collectionType,
                    loanAmount: Number(tx.loan?.amount || 0),
                    principalAmount: Number(tx.principalAmount || 0),
                    interestAmount: Number(tx.interestAmount || 0),
                    totalAmount: Number(tx.amount || 0),
                    loanAdvanceAmount: savingsAmount,
                    walletAdvance: 0,
                    walletPay: 0,
                    thrift1: 0,
                    thrift2: 0,
                    remarks: tx.remarks,
                    isEodLocked: !!branchLock && getKolkataCalendarYmd(tx.transactionDate) < getKolkataCalendarYmd(branchLock.currentWorkingDate),
                    isAllocationLocked: !!tx.eodAllocatedAt,
                    isReversed: tx.isReversed,
                    revertedAt: tx.revertedAt ? tx.revertedAt.toISOString() : null,
                    revertedByName: tx.revertedBy ? `${tx.revertedBy.firstName} ${tx.revertedBy.lastName}` : null,
                    revertedByEmployeeId: tx.revertedBy?.employeeId ?? null,
                    revertReason: tx.revertReason ?? null,
                    revertLocation: toRevertLocationDto(tx),
                });
            }

            // Loan-advance-only submissions (collected amount = 0) create only a
            // SAVINGS_COLLECTION transaction, with no REPAYMENT row to merge into
            // above — surface them as their own row so they aren't dropped from
            // the approval queue entirely. Tagged LOAN_ADVANCE (the wallet feature),
            // not ADVANCE — ADVANCE means an EMI repaid before its due date.
            for (const tx of pendingTransactions) {
                if ((tx.type as string) !== 'SAVINGS_COLLECTION') continue;
                const key = tx.collectionBatchId ? `${tx.collectionBatchId}:${tx.loanId}` : null;
                if (key && repaymentRowKeys.has(key)) continue;

                const totalDues = tx.loan?.loanProduct?.numberOfDues;

                rows.push({
                    transactionId: tx.id,
                    batchId: tx.collectionBatchId,
                    clientId: tx.clientId,
                    clientCode: tx.client?.clientId || 'N/A',
                    clientName: tx.client ? `${tx.client.firstName} ${tx.client.lastName}` : 'Unknown Client',
                    loanNumber: tx.loan?.loanNumber || 'N/A',
                    productName: tx.loan?.loanProduct?.productName || 'N/A',
                    funderName: tx.loan?.funder?.funderName || 'own fund',
                    isGoldLoan: isGoldLoanProduct(tx.loan?.loanProduct?.loanProductType?.name),
                    centerName: tx.center?.name || 'Manual',
                    centerCode: tx.center?.code || '',
                    collectedByName: tx.collectedBy ? `${tx.collectedBy.firstName} ${tx.collectedBy.lastName}` : 'System',
                    collectedById: tx.collectedBy?.id || '',
                    dueCount: totalDues ? `- / ${totalDues}` : '?',
                    dueDate: null,
                    collectionDate: tx.transactionDate.toISOString(),
                    status: tx.status as string,
                    mode: 'LOAN_ADVANCE',
                    collectionType: 'ADVANCE',
                    loanAmount: Number(tx.loan?.amount || 0),
                    principalAmount: 0,
                    interestAmount: 0,
                    totalAmount: 0,
                    loanAdvanceAmount: Number(tx.amount || 0),
                    walletAdvance: 0,
                    walletPay: 0,
                    thrift1: 0,
                    thrift2: 0,
                    remarks: tx.remarks,
                    isEodLocked: !!branchLock && getKolkataCalendarYmd(tx.transactionDate) < getKolkataCalendarYmd(branchLock.currentWorkingDate),
                    isAllocationLocked: !!tx.eodAllocatedAt,
                    isReversed: tx.isReversed,
                    revertedAt: tx.revertedAt ? tx.revertedAt.toISOString() : null,
                    revertedByName: tx.revertedBy ? `${tx.revertedBy.firstName} ${tx.revertedBy.lastName}` : null,
                    revertedByEmployeeId: tx.revertedBy?.employeeId ?? null,
                    revertReason: tx.revertReason ?? null,
                    revertLocation: toRevertLocationDto(tx),
                });
            }

            // Denomination breakdown grouped by center (for the "Collection Denomination
            // Details" panel) — sourced from each batch's CollectionMeetingRecord.
            const batchIds = [...new Set(rows.map((r) => r.batchId).filter((id): id is string => !!id))];
            const denominationByCenter: Record<string, {
                centerName: string; centerCode: string;
                d500: number; d200: number; d100: number; d50: number;
                d20: number; d10: number; d5: number; d2: number; d1: number; totalAmount: number;
            }> = {};

            if (batchIds.length > 0) {
                const meetingRecords = await prisma.collectionMeetingRecord.findMany({
                    where: { collectionBatchId: { in: batchIds } },
                    select: {
                        collectionBatchId: true,
                        d500: true, d200: true, d100: true, d50: true,
                        d20: true, d10: true, d5: true, d2: true, d1: true,
                        upi: true, totalAmount: true,
                    },
                });
                const meetingByBatchId = new Map(meetingRecords.map((m) => [m.collectionBatchId, m]));
                const centerByBatchId = new Map(rows.map((r) => [r.batchId, { name: r.centerName, code: r.centerCode }]));

                for (const batchId of batchIds) {
                    const meeting = meetingByBatchId.get(batchId);
                    if (!meeting) continue;
                    const center = centerByBatchId.get(batchId) || { name: 'Manual', code: '' };
                    const key = `${center.code}|${center.name}`;
                    if (!denominationByCenter[key]) {
                        denominationByCenter[key] = {
                            centerName: center.name, centerCode: center.code,
                            d500: 0, d200: 0, d100: 0, d50: 0,
                            d20: 0, d10: 0, d5: 0, d2: 0, d1: 0, totalAmount: 0,
                        };
                    }
                    const bucket = denominationByCenter[key];
                    bucket.d500 += meeting.d500; bucket.d200 += meeting.d200;
                    bucket.d100 += meeting.d100; bucket.d50 += meeting.d50; bucket.d20 += meeting.d20;
                    bucket.d10 += meeting.d10; bucket.d5 += meeting.d5; bucket.d2 += meeting.d2; bucket.d1 += meeting.d1;
                    bucket.totalAmount += Number(meeting.totalAmount);
                }
            }

            return successResponse({
                rows,
                denominationByCenter: Object.values(denominationByCenter),
            }, 'Pending collections fetched successfully');
        } catch (error) {
            console.error('[Collection Approval] GET Error:', error);
            return errorResponse('Failed to fetch pending collections', 500);
        }
    })(request);
}

/**
 * POST /api/collections/approve
 * Approve or Reject a collection batch
 */
export async function POST(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            if (!user.branchId) {
                return errorResponse('Branch context is required for collection approval', 400);
            }

            const { batchId, transactionId, transactionIds, action, rejectionReason } = await req.json();
            const idList: string[] = Array.isArray(transactionIds) ? transactionIds.filter((id) => typeof id === 'string' && id) : [];

            if ((!batchId && !transactionId && idList.length === 0) || !action) {
                return errorResponse('Batch ID, Transaction ID(s) and action are required', 400);
            }

            const transactionInclude = {
                loan: {
                    include: {
                        schedules: {
                            orderBy: { dueDate: 'asc' as const },
                        },
                    },
                },
                lines: true,
                collectedBy: {
                    select: {
                        id: true,
                        role: true,
                    },
                },
            };

            // Single-row approve: scope to just this client's rows within the batch
            // (their REPAYMENT row plus any paired SAVINGS_COLLECTION row for the same loan),
            // so approving one member doesn't touch the rest of the center's batch.
            let transactions;
            if (idList.length > 0) {
                // Funder-wise "Approve All" bulk approve: the caller (Collection Approval's
                // Demand/Advance/Arrear/Gold tabs, grouped by funder) hands over the visible
                // rows' transaction IDs. Each one is expanded to its own batchId+loanId pair
                // (which also pulls in its paired SAVINGS_COLLECTION loan-advance row) — same
                // scoping as the single-transactionId path above, just for many rows at once.
                const primaries = await prisma.loanTransaction.findMany({
                    where: { id: { in: idList }, status: 'PENDING' },
                    select: { id: true, collectionBatchId: true, loanId: true },
                });
                if (primaries.length === 0) {
                    return errorResponse('No pending transactions found for the selected rows', 404);
                }
                const batchLoanPairs = new Map<string, { collectionBatchId: string; loanId: string }>();
                const idsWithoutBatch: string[] = [];
                for (const p of primaries) {
                    if (p.collectionBatchId) {
                        batchLoanPairs.set(`${p.collectionBatchId}:${p.loanId}`, {
                            collectionBatchId: p.collectionBatchId,
                            loanId: p.loanId,
                        });
                    } else {
                        idsWithoutBatch.push(p.id);
                    }
                }
                transactions = await prisma.loanTransaction.findMany({
                    where: {
                        status: 'PENDING',
                        OR: [
                            ...Array.from(batchLoanPairs.values()).map((pair) => ({
                                collectionBatchId: pair.collectionBatchId,
                                loanId: pair.loanId,
                            })),
                            ...(idsWithoutBatch.length > 0 ? [{ id: { in: idsWithoutBatch } }] : []),
                        ],
                    },
                    include: transactionInclude,
                });
            } else if (transactionId) {
                const primary = await prisma.loanTransaction.findUnique({
                    where: { id: transactionId },
                    select: { collectionBatchId: true, loanId: true, status: true },
                });
                if (!primary || primary.status !== 'PENDING') {
                    return errorResponse('Transaction not found or already processed', 404);
                }
                transactions = await prisma.loanTransaction.findMany({
                    where: primary.collectionBatchId
                        ? { collectionBatchId: primary.collectionBatchId, loanId: primary.loanId, status: 'PENDING' }
                        : { id: transactionId, status: 'PENDING' },
                    include: transactionInclude,
                });
            } else {
                // Fetch all transactions in this batch, including per-installment lines
                transactions = await prisma.loanTransaction.findMany({
                    where: { collectionBatchId: batchId, status: 'PENDING' },
                    include: transactionInclude,
                });
            }

            if (transactions.length === 0) {
                return errorResponse('No pending transactions found for this batch', 404);
            }

            if (user.role !== 'ADMIN') {
                // Allow processing collections from any branch the user is assigned to
                // (UserBranchAssignment / AreaManagerBranch), not just their active/primary branch.
                const permittedBranchIds = await getPermittedBranchIds(user);
                const outOfBranch =
                    permittedBranchIds !== null &&
                    transactions.some((tx) => !permittedBranchIds.includes(tx.branchId));
                if (outOfBranch) {
                    return errorResponse('Cannot process collections from another branch', 403);
                }
            }

            // Branch lock check (use the first transaction's branch)
            const lockResponse = await assertBranchNotLocked(transactions[0].branchId);
            if (lockResponse) return lockResponse;

            if (action === 'REJECT') {
                await (prisma.loanTransaction as any).updateMany({
                    where: { id: { in: transactions.map((t) => t.id) } },
                    data: {
                        status: 'REJECTED',
                        rejectionReason,
                        approvedById: user.userId,
                        approvedAt: new Date()
                    }
                });
                return successResponse(
                    null,
                    transactionId
                        ? 'Collection rejected successfully'
                        : idList.length > 0
                            ? `Successfully rejected ${transactions.length} collections.`
                            : 'Batch rejected successfully'
                );
            }

            if (action === 'APPROVE') {
                // A loan that was closed out since this collection was queued
                // (e.g. an approved preclosure settled every schedule) must not
                // have a stale collection applied on top — that double-counts the
                // dues the closure already covered. Reject the collection instead.
                const closedLoanTxn = transactions.find(
                    (t) => !t.loan?.isActive || t.loan?.disbursementStatus === 'CLOSED'
                );
                if (closedLoanTxn) {
                    return errorResponse(
                        `Loan ${closedLoanTxn.loan?.loanNumber ?? closedLoanTxn.loanId} is already closed — reject this collection instead of approving it.`,
                        409
                    );
                }

                // IMPORTANT: This is the Maker-Checker "Checker" step where balances are actually updated
                // We now apply per-installment lines instead of guessing schedules
                const result = await prisma.$transaction(
                    async (tx) => {
                    const loanIdsToCheckForClosure = new Map<string, Date>();
                    const scheduleStateByLoan = new Map(
                        transactions.map((item) => [
                            item.loanId,
                            item.loan.schedules.map((schedule) => ({
                                id: schedule.id,
                                installmentNo: schedule.installmentNo,
                                dueDate: schedule.dueDate,
                                principalDue: Number(schedule.principalDue),
                                interestDue: Number(schedule.interestDue),
                                feesDue: Number(schedule.feesDue || 0),
                                penaltiesDue: Number(schedule.penaltiesDue || 0),
                                principalPaid: Number(schedule.principalPaid || 0),
                                interestPaid: Number(schedule.interestPaid || 0),
                                feesPaid: Number(schedule.feesPaid || 0),
                                penaltiesPaid: Number(schedule.penaltiesPaid || 0),
                            })),
                        ])
                    );

                    for (const transaction of transactions) {
                        // SAVINGS_COLLECTION: approve, update Loan.savingsPaid, Client.loanAdvance, and schedule.savingsPaid
                        if ((transaction.type as string) === 'SAVINGS_COLLECTION') {
                            await claimPendingTransaction(tx, transaction, user.userId);
                            await tx.loan.update({
                                where: { id: transaction.loanId },
                                data: { savingsPaid: { increment: Number(transaction.amount) } },
                            });
                            // Increment client-wise loan advance balance
                            await tx.client.update({
                                where: { id: transaction.clientId },
                                data: { loanAdvance: { increment: Number(transaction.amount) } },
                            });

                            // Distribute savings to schedules (overdue/current, ascending by dueDate)
                            const allSchedules = transaction.loan.schedules;
                            let remaining = Number(transaction.amount);
                            for (const sched of allSchedules) {
                                if (remaining <= 0) break;
                                const savingsDue = Number(sched.savingsDue || 0);
                                const savingsPaid = Number(sched.savingsPaid || 0);
                                const savingsRemaining = Math.max(0, savingsDue - savingsPaid);
                                if (savingsRemaining <= 0) continue;
                                const apply = Math.min(remaining, savingsRemaining);
                                const newSavingsPaid = Number((savingsPaid + apply).toFixed(2));
                                await tx.loanSchedule.update({
                                    where: { id: sched.id },
                                    data: { savingsPaid: newSavingsPaid },
                                });
                                remaining = Number((remaining - apply).toFixed(2));
                            }
                            continue;
                        }

                        let transactionLines = transaction.lines;
                        const scheduleState = scheduleStateByLoan.get(transaction.loanId) || [];

                        if (transactionLines.length === 0) {
                            const repaired = allocateTransactionLinesFromComponentBudgets(
                                scheduleState,
                                {
                                    principalAmount: Number(transaction.principalAmount || 0),
                                    interestAmount: Number(transaction.interestAmount || 0),
                                    feesAmount: Number(transaction.feesAmount || 0),
                                    penaltyAmount: Number(transaction.penaltyAmount || 0),
                                }
                            );

                            if (repaired.lines.length === 0) {
                                throw new Error(
                                    `Pending batch ${batchId} contains transaction ${transaction.transactionId} without recoverable installment lines`
                                );
                            }

                            await tx.loanTransactionLine.createMany({
                                data: repaired.lines.map((line) => ({
                                    transactionId: transaction.id,
                                    scheduleId: line.scheduleId,
                                    installmentNo: line.installmentNo,
                                    principalAmount: line.principalAmount,
                                    interestAmount: line.interestAmount,
                                    feesAmount: line.feesAmount,
                                    penaltyAmount: line.penaltyAmount,
                                    lineTotal: line.lineTotal,
                                })),
                            });

                            transactionLines = repaired.lines.map((line) => ({
                                id: '',
                                transactionId: transaction.id,
                                scheduleId: line.scheduleId,
                                installmentNo: line.installmentNo,
                                principalAmount: line.principalAmount as any,
                                interestAmount: line.interestAmount as any,
                                feesAmount: line.feesAmount as any,
                                penaltyAmount: line.penaltyAmount as any,
                                lineTotal: line.lineTotal as any,
                            }));
                        }

                        // 1. Update the Transaction Status
                        await claimPendingTransaction(tx, transaction, user.userId);

                        // 2. Apply each line to its schedule (one findMany per txn, not per line — fewer round-trips)
                        const lineScheduleIds = [...new Set(transactionLines.map((l) => l.scheduleId))];
                        const dbSchedules =
                            lineScheduleIds.length > 0
                                ? await tx.loanSchedule.findMany({
                                      where: { id: { in: lineScheduleIds } },
                                  })
                                : [];
                        const workingByScheduleId = new Map<string, ScheduleApplyRow>(
                            dbSchedules.map((s) => [
                                s.id,
                                {
                                    id: s.id,
                                    principalPaid: Number(s.principalPaid),
                                    interestPaid: Number(s.interestPaid),
                                    feesPaid: Number(s.feesPaid || 0),
                                    penaltiesPaid: Number(s.penaltiesPaid || 0),
                                    principalDue: Number(s.principalDue),
                                    interestDue: Number(s.interestDue),
                                    feesDue: Number(s.feesDue || 0),
                                    penaltiesDue: Number(s.penaltiesDue || 0),
                                    status: s.status,
                                    paidAt: s.paidAt,
                                },
                            ])
                        );

                        for (const line of transactionLines) {
                            const schedule = workingByScheduleId.get(line.scheduleId);
                            if (!schedule) {
                                continue;
                            }

                            const principalPaid = Number(line.principalAmount || 0);
                            const interestPaid = Number(line.interestAmount || 0);
                            const feesPaid = Number(line.feesAmount || 0);
                            const penaltyPaid = Number(line.penaltyAmount || 0);

                            const newPrincipalPaid = schedule.principalPaid + principalPaid;
                            const newInterestPaid = schedule.interestPaid + interestPaid;
                            const newFeesPaid = schedule.feesPaid + feesPaid;
                            const newPenaltyPaid = schedule.penaltiesPaid + penaltyPaid;
                            const totalPaidNow = newPrincipalPaid + newInterestPaid + newFeesPaid + newPenaltyPaid;
                            const totalDue =
                                schedule.principalDue +
                                schedule.interestDue +
                                schedule.feesDue +
                                schedule.penaltiesDue;

                            let newStatus: ScheduleStatus = schedule.status;
                            if (totalPaidNow >= totalDue) {
                                newStatus = 'PAID';
                            } else if (totalPaidNow > 0) {
                                newStatus = 'PARTIALLY_PAID';
                            }

                            await tx.loanSchedule.update({
                                where: { id: schedule.id },
                                data: {
                                    principalPaid: newPrincipalPaid,
                                    interestPaid: newInterestPaid,
                                    feesPaid: newFeesPaid,
                                    penaltiesPaid: newPenaltyPaid,
                                    totalPaid: totalPaidNow,
                                    status: newStatus,
                                    paidAt: newStatus === 'PAID' ? transaction.transactionDate : schedule.paidAt,
                                },
                            });

                            schedule.principalPaid = newPrincipalPaid;
                            schedule.interestPaid = newInterestPaid;
                            schedule.feesPaid = newFeesPaid;
                            schedule.penaltiesPaid = newPenaltyPaid;
                            schedule.status = newStatus;
                            if (newStatus === 'PAID') {
                                schedule.paidAt = transaction.transactionDate;
                            }

                            const stateSchedule = scheduleState.find((item) => item.id === line.scheduleId);
                            if (stateSchedule) {
                                stateSchedule.principalPaid += principalPaid;
                                stateSchedule.interestPaid += interestPaid;
                                stateSchedule.feesPaid += feesPaid;
                                stateSchedule.penaltiesPaid += penaltyPaid;
                            }
                        }

                        // 3. Update overall loan totals from transaction header
                        await tx.loan.update({
                            where: { id: transaction.loanId },
                            data: {
                                principalPaid: { increment: Number(transaction.principalAmount || 0) },
                                interestPaid: { increment: Number(transaction.interestAmount || 0) },
                                penaltiesPaid: { increment: Number(transaction.penaltyAmount || 0) },
                                lastPaymentDate: transaction.transactionDate,
                            },
                        });

                        loanIdsToCheckForClosure.set(transaction.loanId, transaction.transactionDate);
                    }

                    // NEW: after all lines/totals in this batch are applied, close any loan
                    // whose final due just got fully paid off.
                    for (const [loanId, transactionDate] of loanIdsToCheckForClosure) {
                        await closeLoanIfFullyPaid(tx, loanId, transactionDate);
                    }

                    return transactions.length;
                    },
                    {
                        timeout: COLLECTION_APPROVE_TX_TIMEOUT_MS,
                        maxWait: COLLECTION_APPROVE_TX_MAX_WAIT_MS,
                    }
                );

                await bumpLoanBalance(transactions.map((t) => t.loanId));

                return successResponse(
                    { count: result },
                    `Successfully approved ${result} collections. Balances updated.`
                );
            }

            return errorResponse('Invalid action', 400);
        } catch (error) {
            if (error instanceof CollectionAlreadyProcessedError) {
                return errorResponse('These collections were already processed. Refresh and check the status.', 409);
            }
            console.error('[Collection Approval] POST Error:', error);
            return errorResponse('Failed to process approval', 500);
        }
    })(request);
}