import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import {
    assertBranchNotLocked,
    getKolkataCalendarYmd,
} from '@/app/lib/branch-lock';
import { getPermittedBranchIds, resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';
import { unwindForeclosureFinalization } from '@/app/lib/foreclosure-workflow';
import { bumpLoanBalance } from '@/app/lib/cache/loan-balance-cache';
import { assertSameEodDay } from '@/app/lib/revert-eod-guard';
import { revertLocationFields, revertLocationColumns, toRevertLocationDto } from '@/app/lib/revert-location';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const FORECLOSURE_DELETE_ROLES = ['BRANCH_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'] as const;

// Mirrors assertSameEodDay's message so the list's blocked reason matches what DELETE returns.
const EOD_PASSED_ERROR = 'EOD has already been processed past this date — it can no longer be reverted.';

// A foreclosure that has already been picked up by "Allocate for EOD" has a posted GL
// voucher (postEodClosureAllocation) and a finalized loan — reverting it here would leave
// that voucher un-reversed (this route only ever un-does the un-allocated case: just the
// LoanTransaction). Mirrors assertNotEodAllocated's rule for REPAYMENT collections (see
// app/lib/revert-eod-guard.ts) — undo the allocation first, via Allocation Revert.
const FORECLOSURE_ALREADY_ALLOCATED_ERROR =
    'This preclosure has been allocated for EOD settlement (GL posted, loan closed). Please revert the Allocation first (Allocation Revert), then try again.';

const RevertSchema = z.object({
    reason: z.string().min(1, 'Revert reason is required'),
    ...revertLocationFields,
});

type BranchLockLite = { branchId: string; currentWorkingDate: Date };

/**
 * Same rule as collection revert (assertSameEodDay in app/lib/revert-eod-guard.ts): a
 * preclosure is revertible while the branch's working date has not moved past the
 * preclosure's own date. Same day or an earlier working date (e.g. after an EOD
 * reversal) is allowed; only a branch already past that date is blocked. No role bypass.
 */
function isForeclosureRevertEligible(
    transactionDate: Date,
    branchLock: { currentWorkingDate: Date } | null | undefined
): boolean {
    if (!branchLock) return true;
    return getKolkataCalendarYmd(branchLock.currentWorkingDate) <= getKolkataCalendarYmd(transactionDate);
}

async function fetchBranchLocksLite(branchIds: string[]): Promise<BranchLockLite[]> {
    if (branchIds.length === 0) return [];
    return prisma.branchLock.findMany({
        where: { branchId: { in: branchIds } },
        select: { branchId: true, currentWorkingDate: true },
    });
}

export async function GET(request: NextRequest) {
    return withRole([...FORECLOSURE_DELETE_ROLES], async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const action = searchParams.get('action');
            const branchIdParam = searchParams.get('branchId');

            if (action === 'centers') {
                const scopedBranchIds = await resolveScopedBranchIds(user, branchIdParam);

                const centers = await prisma.center.findMany({
                    where: {
                        isActive: true,
                        ...(scopedBranchIds !== null
                            ? { branchId: scopedBranchIds.length === 1 ? scopedBranchIds[0] : { in: scopedBranchIds } }
                            : {}),
                    },
                    select: {
                        id: true,
                        name: true,
                        code: true,
                        branchId: true,
                        branch: { select: { code: true, name: true } },
                    },
                    orderBy: { name: 'asc' },
                });
                return successResponse(centers, 'Centers fetched successfully');
            }

            if (action === 'workingDate') {
                const scopedBranchIds = await resolveScopedBranchIds(user, branchIdParam);

                // Only meaningful for a single resolved branch — 'all' (or an unrestricted
                // HO admin with no branchId) has no single working date; client falls back.
                if (scopedBranchIds === null || scopedBranchIds.length !== 1) {
                    return successResponse({ workingDate: null }, 'No single branch resolved');
                }

                const [branchLock] = await fetchBranchLocksLite(scopedBranchIds);

                const workingDate = branchLock
                    ? getKolkataCalendarYmd(branchLock.currentWorkingDate)
                    : null; // no BranchLock row yet — client falls back

                return successResponse({ workingDate }, 'Working date fetched successfully');
            }

            if (action === 'search') {
                const centerIdParam = searchParams.get('centerId');
                // 'active' (default) shows currently-standing foreclosures; 'reverted'
                // shows the separate reverted-history view (who/when it was reverted).
                const statusParam = searchParams.get('status') === 'reverted' ? 'reverted' : 'active';
                const scopedBranchIds = await resolveScopedBranchIds(user, branchIdParam);

                const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
                const fromDateParam = searchParams.get('fromDate');
                const toDateParam = searchParams.get('toDate');

                const where: Record<string, unknown> = {
                    type: 'PRECLOSURE',
                    isReversed: statusParam === 'reverted',
                };
                if (scopedBranchIds !== null) {
                    where.branchId = scopedBranchIds.length === 1 ? scopedBranchIds[0] : { in: scopedBranchIds };
                }
                if (centerIdParam && centerIdParam !== 'all') {
                    where.centerId = centerIdParam;
                }
                if ((fromDateParam && YMD_RE.test(fromDateParam)) || (toDateParam && YMD_RE.test(toDateParam))) {
                    const transactionDateFilter: Record<string, Date> = {};
                    if (fromDateParam && YMD_RE.test(fromDateParam)) {
                        transactionDateFilter.gte = new Date(`${fromDateParam}T00:00:00.000Z`);
                    }
                    if (toDateParam && YMD_RE.test(toDateParam)) {
                        transactionDateFilter.lte = new Date(`${toDateParam}T23:59:59.999Z`);
                    }
                    where.transactionDate = transactionDateFilter;
                }

                const transactions = await prisma.loanTransaction.findMany({
                    where,
                    select: {
                        id: true,
                        branchId: true,
                        transactionDate: true,
                        createdAt: true,
                        amount: true,
                        principalAmount: true,
                        interestAmount: true,
                        isReversed: true,
                        revertedAt: true,
                        revertReason: true,
                        revertLatitude: true,
                        revertLongitude: true,
                        eodAllocatedAt: true,
                        loan: { select: { loanNumber: true } },
                        client: { select: { firstName: true, lastName: true } },
                        collectedBy: { select: { firstName: true, lastName: true, employeeId: true } },
                        approvedBy: { select: { firstName: true, lastName: true, employeeId: true } },
                        revertedBy: { select: { firstName: true, lastName: true, employeeId: true } },
                        foreclosureRequest: { select: { principalAmount: true, interestAmount: true } },
                    },
                    orderBy: statusParam === 'reverted' ? { revertedAt: 'desc' } : { transactionDate: 'desc' },
                    take: 500,
                });

                const distinctBranchIds = Array.from(new Set(transactions.map((t) => t.branchId)));
                const branchLocks = await fetchBranchLocksLite(distinctBranchIds);
                const branchLockMap = new Map(branchLocks.map((bl) => [bl.branchId, bl]));

                const rows = transactions.map((t) => {
                    const dateEligible = isForeclosureRevertEligible(t.transactionDate, branchLockMap.get(t.branchId));
                    const isAllocated = t.eodAllocatedAt !== null;
                    const canRevert = !t.isReversed && !isAllocated && dateEligible;
                    const revertBlockedReason = t.isReversed
                        ? 'This preclosure has already been reverted.'
                        : isAllocated
                            ? FORECLOSURE_ALREADY_ALLOCATED_ERROR
                            : !dateEligible
                                ? EOD_PASSED_ERROR
                                : null;

                    const principalAmount = t.principalAmount ?? t.foreclosureRequest?.principalAmount ?? null;
                    const interestAmount = t.interestAmount ?? t.foreclosureRequest?.interestAmount ?? null;

                    return {
                        transactionId: t.id,
                        branchId: t.branchId,
                        transactionDate: t.transactionDate.toISOString(),
                        clientName: `${t.client.firstName} ${t.client.lastName}`,
                        loanAccountNo: t.loan.loanNumber,
                        amount: Number(t.amount),
                        principalAmount: principalAmount != null ? Number(principalAmount) : 0,
                        interestAmount: interestAmount != null ? Number(interestAmount) : 0,
                        collectedByName: `${t.collectedBy.firstName} ${t.collectedBy.lastName}`,
                        collectedByEmployeeId: t.collectedBy.employeeId,
                        approvedByName: t.approvedBy ? `${t.approvedBy.firstName} ${t.approvedBy.lastName}` : null,
                        isReversed: t.isReversed,
                        canRevert,
                        revertBlockedReason,
                        revertedAt: t.revertedAt ? t.revertedAt.toISOString() : null,
                        revertedByName: t.revertedBy ? `${t.revertedBy.firstName} ${t.revertedBy.lastName}` : null,
                        revertedByEmployeeId: t.revertedBy?.employeeId ?? null,
                        revertReason: t.revertReason ?? null,
                        revertLocation: toRevertLocationDto(t),
                    };
                });

                return successResponse(rows, 'Preclosures fetched successfully');
            }

            return errorResponse('Invalid action', 400);

        } catch (error) {
            console.error('[Delete Foreclosure GET] Error:', error);
            return errorResponse('Failed to fetch data', 500);
        }
    })(request);
}

export async function DELETE(request: NextRequest) {
    return withRole([...FORECLOSURE_DELETE_ROLES], async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const transactionId = searchParams.get('transactionId');
            const branchId = searchParams.get('branchId') || request.headers.get('X-Branch-Id');

            if (!transactionId) {
                return errorResponse('Transaction ID is required', 400);
            }
            if (!branchId) {
                return errorResponse('Branch ID is required', 400);
            }

            let reason: string;
            let location: { latitude: number; longitude: number };
            try {
                const body = await req.json();
                const parsedBody = RevertSchema.parse(body);
                reason = parsedBody.reason;
                location = { latitude: parsedBody.latitude, longitude: parsedBody.longitude };
            } catch (parseError) {
                if (parseError instanceof z.ZodError) {
                    return errorResponse(parseError.errors[0].message, 400);
                }
                return errorResponse('Revert reason is required', 400);
            }

            // Multi-tenancy boundary — the X-Branch-Id header must actually be
            // one of the branches this user is permitted to operate on.
            const permittedBranchIds = await getPermittedBranchIds(user);
            if (permittedBranchIds !== null && !permittedBranchIds.includes(branchId)) {
                return errorResponse('You do not have access to this branch', 403);
            }

            // Guard branch lock (time-of-day write window — separate from the
            // working-date eligibility rule checked below).
            const lockResponse = await assertBranchNotLocked(branchId);
            if (lockResponse) return lockResponse;

            // Find the PRECLOSURE transaction — scoped to the validated branch so a
            // spoofed transactionId belonging to a different branch can never be reversed here.
            // Looked up regardless of eodAllocatedAt first so an allocated one gets the specific
            // "go revert the Allocation first" message below, rather than a generic 404.
            const transaction = await prisma.loanTransaction.findFirst({
                where: {
                    id: transactionId,
                    branchId,
                    type: 'PRECLOSURE',
                    isReversed: false,
                    status: 'APPROVED',
                },
                select: {
                    id: true,
                    loanId: true,
                    transactionDate: true,
                    eodAllocatedAt: true,
                    remarks: true,
                    principalAmount: true,
                    interestAmount: true,
                    feesAmount: true,
                    penaltyAmount: true,
                },
            });

            if (!transaction) {
                return errorResponse('Preclosure transaction not found or already reversed', 404);
            }

            // Once "Allocate for EOD" has claimed this transaction, postEodClosureAllocation has
            // already posted a GL voucher and finalized the loan (principalPaid/interestPaid/
            // penaltiesPaid incremented, isActive:false, closedDate set) — see
            // eod-closure-allocation.ts. This route only ever undoes the un-allocated case (just
            // the LoanTransaction), so reverting an allocated foreclosure here would leave that
            // voucher orphaned. Block it — Allocation Revert owns undoing that GL posting.
            if (transaction.eodAllocatedAt) {
                return errorResponse(FORECLOSURE_ALREADY_ALLOCATED_ERROR, 403);
            }

            // EOD lock — same rule as collection revert: blocked only once the branch's
            // working date has moved past the preclosure's date (same or earlier is fine).
            const eodError = await assertSameEodDay(prisma, branchId, transaction.transactionDate);
            if (eodError) return errorResponse(eodError, 403);

            // `eodAllocatedAt` being clear here means one of two things: this foreclosure was
            // never allocated at all (approval never finalized the loan — nothing to undo there),
            // OR it *was* allocated and finalized, then that allocation was reverted via
            // Allocation Revert — which deliberately only undoes the GL voucher and un-tags the
            // transaction, leaving the loan/schedules exactly as finalizeClosureCoveredLoan left
            // them (see app/lib/foreclosure-workflow.ts's unwindForeclosureFinalization doc
            // comment). `loan.isActive` tells the two cases apart: still active means never
            // finalized (transaction-only revert below is enough); already inactive means this
            // transaction's finalization is what closed it (a loan can only be foreclosed once),
            // so the loan/schedule unwind still needs to happen here before it's freed up again.
            const loan = await prisma.loan.findUnique({
                where: { id: transaction.loanId },
                select: { isActive: true },
            });

            await prisma.$transaction(async (tx) => {
                // Claim the reversal atomically first: `transaction` was read before this DB
                // transaction opened, so two near-simultaneous deletes could both unwind the
                // same amounts off the schedules/loan.
                const claimed = await tx.loanTransaction.updateMany({
                    where: { id: transaction.id, isReversed: false },
                    data: {
                        isReversed: true,
                        revertedAt: new Date(),
                        revertedById: user.userId,
                        revertReason: reason,
                        ...revertLocationColumns(location),
                        remarks: transaction.remarks ? `${transaction.remarks}\n[REVERSED: ${reason}]` : `[REVERSED: ${reason}]`,
                    },
                });
                if (claimed.count === 0) {
                    throw new Error('ALREADY_REVERSED');
                }

                if (loan && !loan.isActive) {
                    await unwindForeclosureFinalization(tx, {
                        loanId: transaction.loanId,
                        transactionId: transaction.id,
                        principalAmount: Number(transaction.principalAmount || 0),
                        interestAmount: Number(transaction.interestAmount || 0),
                        feesAmount: Number(transaction.feesAmount || 0),
                        penaltyAmount: Number(transaction.penaltyAmount || 0),
                    });
                }
            });

            await bumpLoanBalance(transaction.loanId);

            return successResponse(null, 'Preclosure deleted successfully');

        } catch (error) {
            if (error instanceof Error && error.message === 'ALREADY_REVERSED') {
                return errorResponse('This preclosure was already deleted. Refresh and check the status.', 409);
            }
            console.error('[Delete Foreclosure DELETE] Error:', error);
            return errorResponse('Failed to delete preclosure', 500);
        }
    })(request);
}
