import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { format } from 'date-fns';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/collections/member-collection-details/repayment-history?loanId=X
 * Returns per-installment repayment schedule merged with collection transactions,
 * wallet (loan advance) history, arrear-received totals, and approval status —
 * for the view-only Member Collection Details page.
 */
export async function GET(request: NextRequest) {
    return withRole(['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'], async (req) => {
        try {
            const { searchParams } = new URL(req.url);
            const loanId = searchParams.get('loanId');

            if (!loanId) {
                return errorResponse('loanId is required', 400);
            }

            const loan = await prisma.loan.findUnique({
                where: { id: loanId },
                select: {
                    amount: true,
                    clientId: true,
                    branchId: true,
                    client: { select: { loanAdvance: true } },
                    center: {
                        select: {
                            fdo: { select: { firstName: true, lastName: true } },
                        },
                    },
                    funder: { select: { funderName: true } },
                    schedules: {
                        orderBy: { installmentNo: 'asc' },
                        select: {
                            id: true,
                            installmentNo: true,
                            dueDate: true,
                            principalDue: true,
                            interestDue: true,
                            savingsDue: true,
                            totalDue: true,
                            principalPaid: true,
                            interestPaid: true,
                            savingsPaid: true,
                            status: true,
                            paidAt: true,
                            transactionLines: {
                                where: {
                                    transaction: {
                                        isReversed: false,
                                        // Rejected lines are included too — needed to derive an
                                        // accurate Status per due (see dueStatus below) — but are
                                        // excluded from every amount aggregation further down.
                                        status: { in: ['PENDING', 'APPROVED', 'REJECTED'] as any },
                                    },
                                },
                                select: {
                                    principalAmount: true,
                                    interestAmount: true,
                                    feesAmount: true,
                                    penaltyAmount: true,
                                    lineTotal: true,
                                    transaction: {
                                        select: {
                                            id: true,
                                            transactionId: true,
                                            type: true,
                                            amount: true,
                                            transactionDate: true,
                                            status: true,
                                            collectionType: true,
                                            collectionBatchId: true,
                                            collectedBy: {
                                                select: { firstName: true, lastName: true },
                                            },
                                            approvedBy: {
                                                select: { firstName: true, lastName: true },
                                            },
                                        },
                                    },
                                },
                                orderBy: { transaction: { transactionDate: 'asc' } } as any,
                            },
                        },
                    },
                },
            });

            if (!loan) {
                return errorResponse('Loan not found', 404);
            }

            // Fetch BranchLock — still needed for the Arrear Amount cutoff below.
            const branchLock = loan.branchId
                ? await prisma.branchLock.findUnique({
                      where: { branchId: loan.branchId },
                      select: { currentWorkingDate: true },
                  })
                : null;
            const currentWorkingDate = branchLock?.currentWorkingDate ?? null;

            // Fetch loan advance (savings) transactions separately — not linked to schedules.
            const savingsTxns = await prisma.loanTransaction.findMany({
                where: {
                    loanId,
                    type: { in: ['SAVINGS_COLLECTION', 'SAVINGS_REFUND'] as any },
                    isReversed: false,
                    status: { in: ['PENDING', 'APPROVED'] as any },
                },
                orderBy: { transactionDate: 'asc' },
                select: {
                    transactionId: true,
                    type: true,
                    amount: true,
                    transactionDate: true,
                    collectionBatchId: true,
                },
            });

            let runningLoanAdvanceBalance = 0;
            const loanAdvanceTimeline = savingsTxns.map((t) => {
                if (t.type === 'SAVINGS_COLLECTION') {
                    runningLoanAdvanceBalance += Number(t.amount);
                } else {
                    runningLoanAdvanceBalance -= Number(t.amount);
                }
                return {
                    transactionDate: t.transactionDate,
                    type: t.type as string,
                    amount: Number(t.amount),
                    collectionBatchId: t.collectionBatchId ?? null,
                    balance: parseFloat(runningLoanAdvanceBalance.toFixed(2)),
                };
            });

            // Map each collectionBatchId to the installment it was collected against, so a
            // paired SAVINGS_COLLECTION/SAVINGS_REFUND (created in the same batch as the
            // REPAYMENT — see single-collection & arrear routes) attributes to the exact due
            // it was collected for, rather than an overlapping date window. When a batch
            // touches more than one schedule, attribute to the earliest (primary) due.
            const batchToInstallmentNo = new Map<string, number>();
            for (const schedule of loan.schedules) {
                for (const line of schedule.transactionLines) {
                    const batchId = line.transaction.collectionBatchId;
                    if (!batchId) continue;
                    const existing = batchToInstallmentNo.get(batchId);
                    if (existing === undefined || schedule.installmentNo < existing) {
                        batchToInstallmentNo.set(batchId, schedule.installmentNo);
                    }
                }
            }

            // Compute running loan balance (starts at loan amount, decreases by principalDue per installment)
            let loanBalance = Number(loan.amount);

            const rows = loan.schedules.map((schedule, scheduleIdx) => {
                loanBalance -= Number(schedule.principalDue);

                // Aggregate collected amounts from transaction lines — non-rejected only.
                let totalPaid = 0;
                let principalPaid = 0;
                let interestPaid = 0;
                let feesPaid = 0;
                let penaltyPaid = 0;
                let latestTxnDate: Date | null = null;
                let latestTxnType = 'N/A';
                let collectedByName: string | null = null;

                // Status precedence across ALL fetched lines (including rejected): any PENDING
                // wins, else any APPROVED, else (only REJECTED present) REJECTED. Prevents a due
                // with one APPROVED + one later-REJECTED attempt from showing "Rejected".
                let hasPending = false;
                let hasApproved = false;
                let hasRejected = false;
                let latestApprovedDate: Date | null = null;
                let approvedByName: string | null = null;

                // Arrear received — sum of amounts collected specifically via the Arrear
                // Collection flow (LoanTransaction.collectionType === 'Arrear Collection'),
                // across every matching non-rejected line for this due (handles multiple
                // arrear transactions against the same due).
                let arrearReceivedPrincipal = 0;
                let arrearReceivedInterest = 0;

                for (const line of schedule.transactionLines) {
                    const status = line.transaction.status as string;
                    if (status === 'PENDING') hasPending = true;
                    else if (status === 'APPROVED') hasApproved = true;
                    else if (status === 'REJECTED') hasRejected = true;

                    if (status === 'APPROVED') {
                        const txnDate = new Date(line.transaction.transactionDate);
                        if (!latestApprovedDate || txnDate > latestApprovedDate) {
                            latestApprovedDate = txnDate;
                            approvedByName = line.transaction.approvedBy
                                ? `${line.transaction.approvedBy.firstName} ${line.transaction.approvedBy.lastName}`.trim()
                                : null;
                        }
                    }

                    if (status === 'REJECTED') continue;

                    totalPaid += Number(line.lineTotal);
                    principalPaid += Number(line.principalAmount);
                    interestPaid += Number(line.interestAmount);
                    feesPaid += Number(line.feesAmount);
                    penaltyPaid += Number(line.penaltyAmount);

                    if (line.transaction.collectionType === 'Arrear Collection') {
                        arrearReceivedPrincipal += Number(line.principalAmount);
                        arrearReceivedInterest += Number(line.interestAmount);
                    }

                    const txnDate = new Date(line.transaction.transactionDate);
                    if (!latestTxnDate || txnDate > latestTxnDate) {
                        latestTxnDate = txnDate;
                        latestTxnType = line.transaction.type as string;
                        if (line.transaction.collectedBy) {
                            collectedByName = `${line.transaction.collectedBy.firstName} ${line.transaction.collectedBy.lastName}`.trim();
                        }
                    }
                }

                const dueStatus = hasPending ? 'PENDING' : hasApproved ? 'APPROVED' : hasRejected ? 'REJECTED' : null;

                // Arrear amount (unpaid portion of this due) — only for installments overdue
                // from a previous day; today's/future due is collected via the normal Receive
                // flow, not /api/collections/arrear, which only accepts dueDate < the branch's
                // current working date. Calculation left unchanged.
                const isPastDueSchedule = currentWorkingDate
                    ? new Date(schedule.dueDate) < currentWorkingDate
                    : false;
                const principalDue = Number(schedule.principalDue);
                const interestDue = Number(schedule.interestDue);
                const arrearPrincipal = isPastDueSchedule ? Math.max(0, principalDue - principalPaid) : 0;
                const arrearInterest = isPastDueSchedule ? Math.max(0, interestDue - interestPaid) : 0;
                const arrearTotal = parseFloat((arrearPrincipal + arrearInterest).toFixed(2));
                const arrearReceivedTotal = parseFloat((arrearReceivedPrincipal + arrearReceivedInterest).toFixed(2));

                // Attribute loan advance transactions to this installment: prefer an
                // exact collectionBatchId match (the batch that also paid this due's
                // REPAYMENT), falling back to a strict half-open date window for legacy/
                // unbatched rows.
                const scheduleDue = new Date(schedule.dueDate);
                const nextSchedule = loan.schedules[scheduleIdx + 1];
                const nextDue = nextSchedule ? new Date(nextSchedule.dueDate) : null;

                let loanAdvanceAmount: number | null = null;
                let loanAdvancePayAmount: number | null = null;
                let loanAdvanceBalanceAtRow = 0;

                for (const w of loanAdvanceTimeline) {
                    const wDate = new Date(w.transactionDate);
                    const matchedInstallmentNo = w.collectionBatchId
                        ? batchToInstallmentNo.get(w.collectionBatchId)
                        : undefined;
                    const inWindow =
                        matchedInstallmentNo !== undefined
                            ? matchedInstallmentNo === schedule.installmentNo
                            : nextDue
                              ? wDate >= scheduleDue && wDate < nextDue
                              : wDate >= scheduleDue;

                    if (inWindow) {
                        if (w.type === 'SAVINGS_COLLECTION') {
                            loanAdvanceAmount = (loanAdvanceAmount ?? 0) + w.amount;
                        } else if (w.type === 'SAVINGS_REFUND') {
                            loanAdvancePayAmount = (loanAdvancePayAmount ?? 0) + w.amount;
                        }
                        loanAdvanceBalanceAtRow = w.balance;
                    }
                }

                return {
                    installmentNo: schedule.installmentNo,
                    dueDate: format(new Date(schedule.dueDate), 'dd/MM/yyyy'),
                    principalDue: parseFloat(principalDue.toFixed(2)),
                    interestDue: parseFloat(interestDue.toFixed(2)),
                    // Derived from principal + interest rather than the stored totalDue —
                    // some legacy schedule rows have totalDue persisted as principal + interest
                    // + savings (loan advance), which double-counts the loan advance amount once
                    // the frontend adds loanAdvanceAmount on top for the Total Amount column.
                    dueAmount: parseFloat((principalDue + interestDue).toFixed(2)),
                    transactionDate: latestTxnDate ? latestTxnDate.toISOString() : null,
                    transactionType:
                        latestTxnType === 'REPAYMENT'
                            ? 'Repayment'
                            : latestTxnType === 'PRECLOSURE'
                              ? 'Preclosure'
                              : latestTxnType !== 'N/A'
                                ? latestTxnType
                                : 'N/A',
                    amountPaid: parseFloat(totalPaid.toFixed(2)),
                    breakdown: {
                        principal: parseFloat(principalPaid.toFixed(2)),
                        interest: parseFloat(interestPaid.toFixed(2)),
                        fees: parseFloat(feesPaid.toFixed(2)),
                        penalty: parseFloat(penaltyPaid.toFixed(2)),
                    },
                    loanBalance: parseFloat(Math.max(0, loanBalance).toFixed(2)),
                    // Arrear
                    arrearPrincipal: parseFloat(arrearPrincipal.toFixed(2)),
                    arrearInterest: parseFloat(arrearInterest.toFixed(2)),
                    arrearTotal,
                    arrearReceivedPrincipal: parseFloat(arrearReceivedPrincipal.toFixed(2)),
                    arrearReceivedInterest: parseFloat(arrearReceivedInterest.toFixed(2)),
                    arrearReceivedTotal,
                    // Status
                    transactionStatus: dueStatus,
                    approvedByName: dueStatus === 'APPROVED' ? approvedByName : null,
                    collectedByName,
                    // Loan Advance
                    loanAdvanceAmount,
                    loanAdvancePayAmount,
                    loanAdvanceBalance: loanAdvanceBalanceAtRow,
                };
            });

            const groupOfficerName = loan.center?.fdo
                ? `${loan.center.fdo.firstName} ${loan.center.fdo.lastName}`.trim()
                : null;
            const funderName = loan.funder?.funderName ?? null;
            const loanAdvanceBalance = runningLoanAdvanceBalance;

            return successResponse(
                { rows, groupOfficerName, funderName, loanAdvanceBalance },
                'Repayment history fetched'
            );
        } catch (error: any) {
            console.error('Repayment history error:', error);
            return errorResponse(error.message || 'Failed to fetch repayment history', 500);
        }
    })(request);
}
