import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { userMatchesAllowedApiRoles } from '@/app/lib/user-role-access';
import { assertSameEodDay, assertNotEodAllocated } from '@/app/lib/revert-eod-guard';
import {
    normalizeDenominationCounts,
    calculateDenominationTotal,
    denominationMatchesFlooredCollection,
} from '@/app/lib/denomination-money';
import { bumpLoanBalance } from '@/app/lib/cache/loan-balance-cache';
import { revertSavingsCollectionTx } from '@/app/lib/savings-revert';
import { parseRevertLocation, revertLocationColumns, type RevertLocation } from '@/app/lib/revert-location';

const ALLOWED_ROLES = ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'];

export async function OPTIONS() {
    return handleCorsPreflight();
}

const transactionInclude = {
    loan: {
        include: {
            schedules: {
                orderBy: {
                    installmentNo: 'desc' as const,
                },
            },
        },
    },
    lines: true,
};

type ReversibleTransaction = Prisma.LoanTransactionGetPayload<{ include: typeof transactionInclude }>;

/**
 * Applies one schedule's share of a reversal and returns its new paid state.
 * Shared by both the line-precise path and the legacy LIFO fallback below.
 */
async function reverseAmountsOnSchedule(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    schedule: { id: string; principalPaid: unknown; interestPaid: unknown; feesPaid: unknown; penaltiesPaid: unknown; totalDue: unknown; paidAt: Date | null },
    revPrincipal: number,
    revInterest: number,
    revFees: number,
    revPenalty: number
) {
    const schPrincipalPaid = Number(schedule.principalPaid || 0);
    const schInterestPaid = Number(schedule.interestPaid || 0);
    const schFeesPaid = Number(schedule.feesPaid || 0);
    const schPenaltiesPaid = Number(schedule.penaltiesPaid || 0);

    // Clamp at 0 rather than trusting the caller's amount not to overshoot — the
    // line-precise path passes exactly what THIS transaction recorded, but a
    // schedule can only ever give back what it currently shows as paid (e.g. if
    // it was already independently adjusted since).
    const newPrincipalPaid = Math.max(0, schPrincipalPaid - revPrincipal);
    const newInterestPaid = Math.max(0, schInterestPaid - revInterest);
    const newFeesPaid = Math.max(0, schFeesPaid - revFees);
    const newPenaltiesPaid = Math.max(0, schPenaltiesPaid - revPenalty);
    const newTotalPaid = newPrincipalPaid + newInterestPaid + newFeesPaid + newPenaltiesPaid;
    const totalDue = Number(schedule.totalDue);

    await tx.loanSchedule.update({
        where: { id: schedule.id },
        data: {
            principalPaid: newPrincipalPaid,
            interestPaid: newInterestPaid,
            feesPaid: newFeesPaid,
            penaltiesPaid: newPenaltiesPaid,
            totalPaid: newTotalPaid,
            status: newTotalPaid <= 0 ? 'PENDING' : (newTotalPaid < totalDue ? 'PARTIALLY_PAID' : 'PAID'),
            // paidAt must exist only for fully PAID schedules.
            // Keeping it for PARTIALLY_PAID causes misleading paid-date display in reports.
            paidAt: newTotalPaid >= totalDue ? schedule.paidAt : null,
        }
    });
}

/** Unwinds one transaction's paid amounts off its loan's schedules and marks it reversed. */
async function reverseOneTransaction(
    tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
    transaction: ReversibleTransaction,
    revertedById: string,
    location: RevertLocation,
    remarks?: string
) {
    const loan = transaction.loan;

    // Claim the reversal first, atomically. The transaction rows are read before this
    // DB transaction opens, so two near-simultaneous reverts can both see isReversed=false;
    // without this conditional claim both would subtract the same amounts again.
    const claimed = await tx.loanTransaction.updateMany({
        where: { id: transaction.id, isReversed: false },
        data: {
            isReversed: true,
            revertedAt: new Date(),
            revertedById,
            revertReason: remarks || null,
            ...revertLocationColumns(location),
            remarks: remarks ? `${transaction.remarks || ''}\n[REVERSED: ${remarks}]` : transaction.remarks
        }
    });
    if (claimed.count === 0) {
        throw new Error('ALREADY_REVERSED:' + transaction.id);
    }

    if (transaction.lines.length > 0) {
        // Precise reversal: undo exactly the schedule(s) and amounts THIS
        // transaction's own LoanTransactionLine rows recorded at collection time.
        // This is the only correct way to reverse a transaction that may have
        // spanned multiple installments — the previous LIFO-by-installmentNo
        // approach below walked the loan's CURRENT schedule state blindly, so it
        // could (and did) undo a completely different installment's payment than
        // the one this transaction actually made, whenever some other schedule
        // with a higher installment number also happened to carry a paid amount
        // at revert time (e.g. from an unrelated later collection or backfill).
        const scheduleById = new Map(loan.schedules.map((s) => [s.id, s]));
        for (const line of transaction.lines) {
            const schedule = scheduleById.get(line.scheduleId);
            if (!schedule) continue; // schedule no longer exists — nothing to unwind

            const revPrincipal = Number(line.principalAmount || 0);
            const revInterest = Number(line.interestAmount || 0);
            const revFees = Number(line.feesAmount || 0);
            const revPenalty = Number(line.penaltyAmount || 0);
            if (revPrincipal <= 0 && revInterest <= 0 && revFees <= 0 && revPenalty <= 0) continue;

            await reverseAmountsOnSchedule(tx, schedule, revPrincipal, revInterest, revFees, revPenalty);
        }
    } else {
        // Legacy fallback for transactions that predate per-line tracking (e.g.
        // migrated/backup-loan aggregate transactions) and never recorded which
        // schedule(s) they touched — best-effort LIFO unwind across the loan's
        // schedules, highest installment number first. Kept only for those; every
        // current collection-creation path (arrear/single/bulk/demand) writes
        // LoanTransactionLine rows, so new transactions always take the precise
        // path above.
        let principalToReverse = Number(transaction.principalAmount || 0);
        let interestToReverse = Number(transaction.interestAmount || 0);
        let feesToReverse = Number(transaction.feesAmount || 0);
        let penaltyToReverse = Number(transaction.penaltyAmount || 0);

        for (const schedule of loan.schedules) {
            if (principalToReverse <= 0 && interestToReverse <= 0 && feesToReverse <= 0 && penaltyToReverse <= 0) break;

            const schPrincipalPaid = Number(schedule.principalPaid || 0);
            const schInterestPaid = Number(schedule.interestPaid || 0);
            const schFeesPaid = Number(schedule.feesPaid || 0);
            const schPenaltiesPaid = Number(schedule.penaltiesPaid || 0);

            const revPrincipal = Math.min(principalToReverse, schPrincipalPaid);
            const revInterest = Math.min(interestToReverse, schInterestPaid);
            const revFees = Math.min(feesToReverse, schFeesPaid);
            const revPenalty = Math.min(penaltyToReverse, schPenaltiesPaid);

            if (revPrincipal > 0 || revInterest > 0 || revFees > 0 || revPenalty > 0) {
                await reverseAmountsOnSchedule(tx, schedule, revPrincipal, revInterest, revFees, revPenalty);

                principalToReverse -= revPrincipal;
                interestToReverse -= revInterest;
                feesToReverse -= revFees;
                penaltyToReverse -= revPenalty;
            }
        }
    }

    // 2. Update Loan Summary
    await tx.loan.update({
        where: { id: loan.id },
        data: {
            principalPaid: { decrement: Number(transaction.principalAmount || 0) },
            interestPaid: { decrement: Number(transaction.interestAmount || 0) },
            penaltiesPaid: { decrement: Number(transaction.penaltyAmount || 0) },
        }
    });

}

type DenominationInput = {
    d500?: unknown; d200?: unknown; d100?: unknown; d50?: unknown; d20?: unknown;
    d10?: unknown; d5?: unknown; d2?: unknown; d1?: unknown; upi?: unknown;
};

/**
 * POST /api/collections/client/reverse
 * Reverse one of:
 * - a single collection transaction (`transactionId`)
 * - a hand-picked set of transactions within a batch (`transactionIds`)
 * - every un-reversed APPROVED transaction in a center's day batch (`collectionBatchId`)
 *
 * Optionally pass `denomination` (note-count breakdown + upi) to correct the
 * batch's CollectionMeetingRecord in the same step — required to be internally
 * consistent with whatever remains un-reversed in that batch afterward.
 */
export async function POST(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            if (!(await userMatchesAllowedApiRoles(user, ALLOWED_ROLES))) {
                return errorResponse('Only Admin, Sub Admin, Area Manager, or Branch Manager can reverse transactions', 403);
            }

            const body = await req.json();
            const { transactionId, transactionIds, collectionBatchId, remarks, denomination } = body as {
                transactionId?: string;
                transactionIds?: string[];
                collectionBatchId?: string;
                remarks?: string;
                denomination?: DenominationInput;
            };

            // Location is mandatory for every revert (stamped on each reverted row, incl. swept-in loan advances).
            const parsedLocation = parseRevertLocation(body);
            if ('error' in parsedLocation) return errorResponse(parsedLocation.error, 400);
            const { location } = parsedLocation;

            const hasIdList = Array.isArray(transactionIds) && transactionIds.length > 0;

            if (!transactionId && !collectionBatchId && !hasIdList) {
                return errorResponse('Transaction ID(s) or Collection Batch ID is required', 400);
            }

            let transactions: ReversibleTransaction[];

            if (collectionBatchId) {
                transactions = await prisma.loanTransaction.findMany({
                    where: { collectionBatchId, isReversed: false, status: 'APPROVED' },
                    include: transactionInclude,
                });
                if (transactions.length === 0) {
                    return errorResponse('No reversible transactions found in this batch', 404);
                }
            } else if (hasIdList) {
                transactions = await prisma.loanTransaction.findMany({
                    where: { id: { in: transactionIds } },
                    include: transactionInclude,
                });
                if (transactions.length !== transactionIds!.length) {
                    return errorResponse('One or more transactions were not found', 404);
                }
                if (transactions.some((t) => t.isReversed)) {
                    return errorResponse('One or more selected transactions are already reversed', 400);
                }
                if (transactions.some((t) => t.status !== 'APPROVED')) {
                    return errorResponse('Only approved transactions can be reversed', 400);
                }
            } else {
                const single = await prisma.loanTransaction.findUnique({
                    where: { id: transactionId },
                    include: transactionInclude,
                });
                if (!single) {
                    return errorResponse('Transaction not found', 404);
                }
                if (single.isReversed) {
                    return errorResponse('Transaction is already reversed', 400);
                }
                transactions = [single];
            }

            // EOD lock enforcement: applies to everyone, no Admin bypass — a
            // revert is only possible while EOD hasn't yet moved the branch's
            // working date past the transaction's own date.
            for (const transaction of transactions) {
                const eodError = await assertSameEodDay(prisma, transaction.branchId, transaction.transactionDate);
                if (eodError) return errorResponse(eodError, 403);
            }

            // Allocation lock enforcement: applies to everyone, no Admin bypass —
            // a collection already allocated for EOD must have that allocation
            // reverted first (Allocation Revert), or its GL voucher is orphaned.
            for (const transaction of transactions) {
                const allocationError = assertNotEodAllocated(transaction.eodAllocatedAt);
                if (allocationError) return errorResponse(allocationError, 403);
            }

            // Denomination correction only makes sense scoped to one meeting
            // record — every reverted transaction must share the same batch.
            let denominationBatchId: string | null = null;
            if (denomination) {
                const batchIds = new Set(transactions.map((t) => t.collectionBatchId).filter(Boolean));
                if (batchIds.size !== 1) {
                    return errorResponse(
                        'Denomination correction requires all reverted transactions to belong to the same collection batch',
                        400
                    );
                }
                denominationBatchId = [...batchIds][0] as string;
            }

            console.log('[Delete Collection] Reversing transaction(s):', transactions.map((t) => t.id));

            // Perform reversal (+ optional denomination correction) atomically
            await prisma.$transaction(async (tx) => {
                const affectedLoanIds = new Set<string>();
                const advanceReason = remarks?.trim() || 'Reverted together with center collection';
                const revertAdvance = async (id: string) => {
                    try {
                        await revertSavingsCollectionTx(tx, id, user.userId, advanceReason, location);
                    } catch (e) {
                        throw new Error('LOAN_ADVANCE:' + (e instanceof Error ? e.message : 'Failed to revert loan advance'));
                    }
                };
                const revertedAdvanceIds = new Set<string>();
                for (const transaction of transactions) {
                    // Loan advance rows carry no schedule lines — they unwind savings
                    // balances, not principal/interest, so they take the savings path.
                    if (transaction.type === 'SAVINGS_COLLECTION') {
                        await revertAdvance(transaction.id);
                        revertedAdvanceIds.add(transaction.id);
                        continue;
                    }
                    if (!transaction.loan) continue;
                    await reverseOneTransaction(tx, transaction, user.userId, location, remarks);
                    affectedLoanIds.add(transaction.loanId);
                }

                // Reverting a member's collection also reverts the loan advance collected
                // for that loan in the same batch, for every role allowed to revert — a
                // repayment-only revert left the advance counted as paid while the
                // collection itself was undone.
                const sweepKeys = transactions
                    .filter((t) => t.type === 'REPAYMENT' && t.collectionBatchId)
                    .map((t) => ({ loanId: t.loanId, collectionBatchId: t.collectionBatchId as string }));
                if (sweepKeys.length > 0) {
                    const linkedAdvances = await tx.loanTransaction.findMany({
                        where: { type: 'SAVINGS_COLLECTION', status: 'APPROVED', isReversed: false, OR: sweepKeys },
                        select: { id: true },
                        // newest first — the savings LIFO guard rejects out-of-order reverts
                        orderBy: { approvedAt: 'desc' },
                    });
                    for (const adv of linkedAdvances) {
                        if (revertedAdvanceIds.has(adv.id)) continue;
                        await revertAdvance(adv.id);
                    }
                }

                // Re-open any loan that was auto-closed at approval time (all schedules
                // PAID, zero outstanding — see closeLoanIfFullyPaid in
                // app/api/collections/approve/route.ts) but now has dues again because
                // this revert unwound the settling collection. Scoped to closures with
                // no closureReason — foreclosure / write-off / death closures carry a
                // non-null reason and have their own dedicated revert flows.
                for (const loanId of affectedLoanIds) {
                    const loan = await tx.loan.findUnique({
                        where: { id: loanId },
                        select: {
                            disbursementStatus: true,
                            closureReason: true,
                            schedules: { select: { status: true } },
                        },
                    });
                    if (!loan) continue;
                    if (loan.disbursementStatus !== 'CLOSED' || loan.closureReason) continue;
                    // Precise inverse of the auto-close condition — only re-open a loan
                    // that genuinely no longer settles in full.
                    if (loan.schedules.length > 0 && loan.schedules.every((s) => s.status === 'PAID')) continue;

                    await tx.loan.update({
                        where: { id: loanId },
                        data: {
                            disbursementStatus: 'DISBURSED',
                            // Load-bearing: closeLoanIfFullyPaid() early-returns on
                            // !loan.isActive, so without this the loan would look open
                            // but could never auto-close again after the member re-pays.
                            isActive: true,
                            closedDate: null,
                        },
                    });
                    console.log('[Delete Collection] Re-opened auto-closed loan after revert:', loanId);
                }

                if (denominationBatchId && denomination) {
                    const remaining = await tx.loanTransaction.aggregate({
                        where: { collectionBatchId: denominationBatchId, status: 'APPROVED', isReversed: false },
                        _sum: { amount: true },
                    });
                    const remainingTotal = Number(remaining._sum.amount || 0);

                    const counts = normalizeDenominationCounts(denomination);
                    const upiAmount = Math.max(0, Number(denomination.upi) || 0);
                    const denomTotal = Number((calculateDenominationTotal(counts) + upiAmount).toFixed(2));

                    if (!denominationMatchesFlooredCollection(denomTotal, remainingTotal)) {
                        throw new Error(`DENOM_MISMATCH:${denomTotal}:${remainingTotal}`);
                    }

                    await tx.collectionMeetingRecord.update({
                        where: { collectionBatchId: denominationBatchId },
                        data: {
                            d500: counts.d500, d200: counts.d200, d100: counts.d100, d50: counts.d50,
                            d20: counts.d20, d10: counts.d10, d5: counts.d5, d2: counts.d2, d1: counts.d1,
                            upi: upiAmount,
                            totalAmount: denomTotal,
                        },
                    });
                }
            }, { timeout: 30000 });

            await bumpLoanBalance(transactions.map((t) => t.loanId));

            console.log('[Delete Collection] Transaction(s) reversed successfully:', transactions.map((t) => t.id));

            return successResponse(
                { count: transactions.length },
                transactions.length > 1
                    ? `${transactions.length} transactions reversed successfully`
                    : 'Transaction reversed successfully'
            );

        } catch (error: any) {
            if (typeof error?.message === 'string' && error.message.startsWith('ALREADY_REVERSED:')) {
                return errorResponse('This collection was already reversed. Refresh and check the status.', 409);
            }
            if (typeof error?.message === 'string' && error.message.startsWith('LOAN_ADVANCE:')) {
                return errorResponse(`Could not revert the linked loan advance: ${error.message.slice('LOAN_ADVANCE:'.length)}`, 400);
            }
            if (typeof error?.message === 'string' && error.message.startsWith('DENOM_MISMATCH:')) {
                const [, denomTotal, remainingTotal] = error.message.split(':');
                return errorResponse(
                    `Denomination total (₹${denomTotal}) does not match the remaining collection amount (₹${remainingTotal}) after this revert`,
                    400
                );
            }
            console.error('[Delete Collection] Error reversing transaction:', error);
            return errorResponse('Failed to reverse transaction', 500);
        }
    })(request);
}
