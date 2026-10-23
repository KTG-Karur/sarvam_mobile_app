import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { isAmAssignedToBranch } from '@/app/lib/am-branch-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { getLedgerPaidByScheduleBatched } from '@/app/lib/ledger/schedule-paid-amounts';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseDateOnlyUtc(dateParam: string): Date | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateParam);
    if (!m) return null;

    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));

    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
    ) {
        return null;
    }

    return date;
}

function safeNum(v: unknown): number {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : 0;
}

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/reports/daily-monitoring/zero-collection
 *
 * Zero Collection Report — identifies LOANS that had demand due
 * within [fromDate, tillDate] but received ZERO approved collection
 * during that period.
 *
 * Key business rules (microfinance):
 *  1. One row per LOAN (not per schedule). Demand is aggregated across
 *     all schedules due in the period.
 *  2. Only APPROVED + non-reversed REPAYMENT transactions count as collection.
 *     PENDING (awaiting BM approval) or REJECTED transactions do NOT exclude
 *     a loan from zero-collection.
 *  3. Opening arrears are calculated as-of fromDate using only APPROVED txns.
 *  4. Demand is calculated as-of the report period end, not using the live
 *     schedule.totalPaid snapshot (which could include future payments).
 *  5. Nominee name and phone are fetched from the Client model.
 */
export async function GET(request: NextRequest) {
    return withRole(['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'], async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const fromDateParam = searchParams.get('fromDate');
            const tillDateParam = searchParams.get('tillDate');
            const branchIdParam = searchParams.get('branchId');
            const centerIdParam = searchParams.get('centerId');

            if (!fromDateParam || !tillDateParam) {
                return errorResponse('fromDate and tillDate are required', 400);
            }

            const fromDate = parseDateOnlyUtc(fromDateParam);
            const tillDateStart = parseDateOnlyUtc(tillDateParam);
            if (!fromDate || !tillDateStart) {
                return errorResponse('Invalid date format', 400);
            }
            const tillDate = new Date(tillDateStart);
            tillDate.setUTCHours(23, 59, 59, 999);

            if (fromDate > tillDate) {
                return errorResponse('fromDate cannot be later than tillDate', 400);
            }

            // ─── Branch scoping ──────────────────────────────────────────
            let scopedBranchId: string | null = null;
            if (user.role === 'BRANCH_MANAGER') {
                // Any branch the BM is assigned to (UserBranchAssignment), not just
                // their primary/active branch.
                const permittedBranchIds = await getPermittedBranchIds(user);
                if (permittedBranchIds === null || permittedBranchIds.length === 0) {
                    return errorResponse('Branch context missing for branch manager', 403);
                }
                if (branchIdParam && !permittedBranchIds.includes(branchIdParam)) {
                    return errorResponse('Insufficient permissions for selected branch', 403);
                }
                scopedBranchId = branchIdParam || user.branchId || permittedBranchIds[0];
            } else if (user.role === 'AREA_MANAGER') {
                const requested = branchIdParam || user.branchId || null;
                if (!requested) {
                    return errorResponse('Branch context is required for this report', 400);
                }
                const assigned = await isAmAssignedToBranch(user.userId, requested);
                if (!assigned) {
                    return errorResponse('Insufficient permissions for selected branch', 403);
                }
                scopedBranchId = requested;
            } else {
                scopedBranchId = branchIdParam || user.branchId || null;
                if (!scopedBranchId) {
                    return errorResponse('Branch context is required for this report', 400);
                }
            }

            // ─── 1. Fetch schedules due in this period ───────────────────
            const dueSchedules = await prisma.loanSchedule.findMany({
                where: {
                    dueDate: {
                        gte: fromDate,
                        lte: tillDate,
                    },
                    loan: {
                        isActive: true,
                        disbursementStatus: 'DISBURSED',
                        branchId: scopedBranchId,
                        ...(centerIdParam ? { centerId: centerIdParam } : {}),
                    },
                },
                select: {
                    id: true,
                    loanId: true,
                    installmentNo: true,
                    dueDate: true,
                    totalDue: true,
                    totalPaid: true,
                    principalDue: true,
                    interestDue: true,
                    status: true,
                },
            });

            const loanIds = [...new Set(dueSchedules.map(s => s.loanId))];
            if (loanIds.length === 0) {
                return successResponse([], 'Zero collection records retrieved successfully');
            }

            // ─── 2. Find loans WITH approved collection in this period ───
            // FIX: Only APPROVED + non-reversed transactions count!
            const approvedTxnsInPeriod = await prisma.loanTransaction.groupBy({
                by: ['loanId'],
                where: {
                    loanId: { in: loanIds },
                    transactionDate: { gte: fromDate, lte: tillDate },
                    type: 'REPAYMENT',
                    status: 'APPROVED',
                    isReversed: false,
                    amount: { gt: 0 },
                },
                _sum: { amount: true },
            });

            const loansWithCollection = new Set(approvedTxnsInPeriod.map(t => t.loanId));

            // ─── 3. Zero-collection loan IDs ─────────────────────────────
            const zeroCollectionLoanIds = loanIds.filter(id => !loansWithCollection.has(id));
            if (zeroCollectionLoanIds.length === 0) {
                return successResponse([], 'Zero collection records retrieved successfully');
            }

            // ─── 4. Fetch loan details for zero-collection loans ─────────
            const loans = await prisma.loan.findMany({
                where: { id: { in: zeroCollectionLoanIds } },
                include: {
                    branch: { select: { code: true, name: true } },
                    center: {
                        include: {
                            fdo: { select: { firstName: true, lastName: true } },
                        },
                    },
                    client: {
                        select: {
                            firstName: true,
                            lastName: true,
                            mobileNumber: true,
                            nomineeName: true,
                            nomineePhone: true,
                            nomineeRelation: true,
                        },
                    },
                },
            });

            const loanMap = new Map(loans.map(l => [l.id, l]));

            // ─── 5. Opening arrears — as-of fromDate (APPROVED only) ─────
            // Opening arrears = totalDue before period − APPROVED repayments before period

            const [dueBeforeAgg, approvedRepaidBefore] = await Promise.all([
                prisma.loanSchedule.groupBy({
                    by: ['loanId'],
                    where: {
                        loanId: { in: zeroCollectionLoanIds },
                        dueDate: { lt: fromDate },
                    },
                    _sum: { totalDue: true },
                }),
                prisma.loanTransaction.groupBy({
                    by: ['loanId'],
                    where: {
                        loanId: { in: zeroCollectionLoanIds },
                        transactionDate: { lt: fromDate },
                        type: 'REPAYMENT',
                        status: 'APPROVED',
                        isReversed: false,
                        amount: { gt: 0 },
                    },
                    _sum: { amount: true },
                }),
            ]);

            const dueBeforeMap = new Map(
                dueBeforeAgg.map(r => [r.loanId, safeNum(r._sum.totalDue)])
            );
            const repaidBeforeMap = new Map(
                approvedRepaidBefore.map(r => [r.loanId, safeNum(r._sum.amount)])
            );

            // ─── 6. Approved repaid WITHIN the period (for demand calc) ──
            const approvedRepaidInPeriodForZero = await prisma.loanTransaction.groupBy({
                by: ['loanId'],
                where: {
                    loanId: { in: zeroCollectionLoanIds },
                    transactionDate: { gte: fromDate, lte: tillDate },
                    type: 'REPAYMENT',
                    status: 'APPROVED',
                    isReversed: false,
                    amount: { gt: 0 },
                },
                _sum: { amount: true },
            });
            // (This will be empty for zero-collection loans, but kept for correctness)
            const repaidInPeriodMap = new Map(
                approvedRepaidInPeriodForZero.map(r => [r.loanId, safeNum(r._sum.amount)])
            );

            // ─── 6b. Advance already paid for in-period installments ─────
            // Payments dated BEFORE the period that were applied to installments falling inside it
            // (LoanTransactionLine is the source of truth). They reduce the period's demand and must
            // not be counted again as paying off opening arrears.
            const inPeriodScheduleIds = dueSchedules
                .filter(s => zeroCollectionLoanIds.includes(s.loanId))
                .map(s => s.id);
            const advancePaidBySchedule = await getLedgerPaidByScheduleBatched(
                new Map([[fromDateParam, inPeriodScheduleIds]])
            );
            const advanceAppliedToPeriodByLoan = new Map<string, number>();

            // ─── 7. Build results — ONE ROW PER LOAN ─────────────────────
            const results: any[] = [];

            // Group schedules by loanId
            const schedulesByLoan = new Map<string, typeof dueSchedules>();
            for (const sched of dueSchedules) {
                if (!zeroCollectionLoanIds.includes(sched.loanId)) continue;
                const arr = schedulesByLoan.get(sched.loanId) || [];
                arr.push(sched);
                schedulesByLoan.set(sched.loanId, arr);
            }

            for (const [loanId, schedules] of schedulesByLoan) {
                const loan = loanMap.get(loanId);
                if (!loan) continue;

                // Aggregate demand across all schedules in this period for this loan
                let totalDemandInPeriod = 0;
                let latestDueDate: Date | null = null;
                let latestInstallmentNo = 0;
                let activeScheduleCount = 0;

                for (const sched of schedules) {
                    if (sched.status === 'PAID' || sched.status === 'WAIVED') continue;

                    // As-of demand: schedule.totalDue (NOT subtracting schedule.totalPaid,
                    // since totalPaid is the live snapshot and may have been updated after period)
                    // For zero-collection loans, by definition no APPROVED payments exist in period,
                    // so the demand is simply the schedule totalDue.
                    // However, partial payments from BEFORE the period could reduce it.
                    // Accurate: demand = totalDue minus advance paid before the period (a member
                    // who paid ahead is not a zero-collection member for what was already covered).
                    const advance = advancePaidBySchedule.get(sched.id);
                    const advanceAmt = advance ? advance.principal + advance.interest : 0;
                    const scheduleDemand = Math.max(0, safeNum(sched.totalDue) - advanceAmt);
                    advanceAppliedToPeriodByLoan.set(
                        loanId,
                        (advanceAppliedToPeriodByLoan.get(loanId) ?? 0) + Math.min(advanceAmt, safeNum(sched.totalDue))
                    );
                    if (scheduleDemand <= 0) continue;

                    totalDemandInPeriod += scheduleDemand;
                    activeScheduleCount++;

                    if (!latestDueDate || sched.dueDate > latestDueDate) {
                        latestDueDate = sched.dueDate;
                        latestInstallmentNo = sched.installmentNo;
                    }
                }

                if (totalDemandInPeriod <= 0) continue;

                // Opening arrears (APPROVED only)
                const dueBefore = dueBeforeMap.get(loanId) || 0;
                // repaidBefore also contains advance paid for in-period installments; that money is
                // already netted from the period demand above, so exclude it from opening arrears.
                const repaidBefore = Math.max(
                    0,
                    (repaidBeforeMap.get(loanId) || 0) - (advanceAppliedToPeriodByLoan.get(loanId) ?? 0)
                );
                const openingArrears = Math.max(0, dueBefore - repaidBefore);

                // Balance = opening arrears + demand in period
                const bal = openingArrears + totalDemandInPeriod;

                // Principal balance
                const principalBal = safeNum(loan.amount) - safeNum(loan.principalPaid);

                results.push({
                    id: `${loanId}_${fromDateParam}`,
                    branchId: loan.branch.code,
                    branchName: loan.branch.name,
                    centerName: `${loan.center.code} - ${loan.center.name}`,
                    memberName: `${loan.client.firstName} ${loan.client.lastName}`.trim(),
                    loanId: loan.loanNumber,
                    dispDate: loan.disbursedLevel1At
                        ? loan.disbursedLevel1At.toISOString()
                        : 'N/A',
                    loanAmount: safeNum(loan.amount),
                    dueDate: latestDueDate ? latestDueDate.toISOString() : 'N/A',
                    frequency: loan.frequency || 'N/A',
                    opArr: Math.round(openingArrears),
                    dueNo: latestInstallmentNo,
                    demand: Math.round(totalDemandInPeriod),
                    bal: Math.round(bal),
                    principalBal: Math.round(principalBal),
                    phone: loan.client.mobileNumber || 'N/A',
                    nomineeName: loan.client.nomineeName || 'N/A',
                    nomineePhone: loan.client.nomineePhone || 'N/A',
                    nomineeRelation: loan.client.nomineeRelation || 'N/A',
                    fdo: loan.center.fdo
                        ? `${loan.center.fdo.firstName} ${loan.center.fdo.lastName}`
                        : 'Unassigned',
                });
            }

            // Sort by center, then member name
            results.sort((a, b) => {
                const byCen = a.centerName.localeCompare(b.centerName);
                if (byCen !== 0) return byCen;
                return a.memberName.localeCompare(b.memberName);
            });

            return successResponse(results, 'Zero collection records retrieved successfully');
        } catch (error) {
            console.error('Error fetching zero collection report:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to fetch zero collection report',
                500
            );
        }
    })(request);
}
