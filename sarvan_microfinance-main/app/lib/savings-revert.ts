import type { Prisma } from '@prisma/client';
import { revertLocationColumns, type RevertLocation } from '@/app/lib/revert-location';
import { assertSameEodDay, assertNotEodAllocated } from '@/app/lib/revert-eod-guard';
import { subtractDenominationNotes } from '@/app/lib/denomination-money';

type TransactionClient = Prisma.TransactionClient;

/**
 * Savings Collection Revert / Savings Refund Revert share one balance pair —
 * Client.loanAdvance and Loan.savingsPaid — so a LIFO guard scoped to only
 * SAVINGS_COLLECTION (or only SAVINGS_REFUND) is not enough: reverting a
 * collection that a later refund already drew down from would leave the
 * refund's amount unbacked. The guard below enforces newest-first ordering
 * across the *union* of both types for the loan, keyed on approvedAt — the
 * instant each type actually mutated the shared balances (collection at
 * approve time in app/api/collections/approve/route.ts, refund at approve
 * time in app/api/savings/refund/route.ts) — not transactionDate, which for
 * collections is a business/collection date that can be backdated and does
 * not reflect real mutation order.
 */
export async function findLaterUnreversedSavingsActivity(
    tx: TransactionClient,
    loanId: string,
    excludeTransactionDbId: string,
    approvedAt: Date
) {
    return tx.loanTransaction.findFirst({
        where: {
            loanId,
            id: { not: excludeTransactionDbId },
            isReversed: false,
            type: { in: ['SAVINGS_COLLECTION', 'SAVINGS_REFUND'] },
            approvedAt: { gt: approvedAt },
        },
        orderBy: { approvedAt: 'desc' },
    });
}

export interface SavingsScheduleRow {
    id: string;
    installmentNo: number;
    savingsPaid: number;
}

/**
 * Undo a savings-collection ascending fill (app/api/collections/approve/route.ts
 * fills schedules ascending by dueDate up to each schedule's savingsDue gap).
 * Reversing the same total amount in descending installment order reconstructs
 * exactly what this transaction contributed, provided (as the LIFO guard above
 * ensures) no later savings transaction has touched these schedules since —
 * this transaction's own fill was the last write to schedule.savingsPaid, so
 * peeling the same amount off the top undoes only its own contribution.
 */
export function withdrawSavingsDescending(
    schedules: SavingsScheduleRow[],
    amount: number
): Array<{ id: string; newSavingsPaid: number }> {
    const sorted = [...schedules].sort((a, b) => b.installmentNo - a.installmentNo);
    let remaining = Number(amount.toFixed(2));
    const updates: Array<{ id: string; newSavingsPaid: number }> = [];

    for (const schedule of sorted) {
        if (remaining <= 0) break;
        const paid = Number(schedule.savingsPaid || 0);
        if (paid <= 0) continue;
        const withdraw = Math.min(remaining, paid);
        const newSavingsPaid = Number((paid - withdraw).toFixed(2));
        updates.push({ id: schedule.id, newSavingsPaid });
        remaining = Number((remaining - withdraw).toFixed(2));
    }

    return updates;
}

/**
 * Undo one APPROVED SAVINGS_COLLECTION (loan advance) inside the caller's
 * transaction: LIFO + EOD + allocation guards, schedule/loan/client savings
 * balances, the txn's reversed flags, and its share of the meeting denomination.
 * Shared by the Admin Loan Advance Revert page and the collection revert, which
 * sweeps in the loan advance collected in the same batch.
 */
export async function revertSavingsCollectionTx(
    tx: TransactionClient,
    transactionDbId: string,
    userId: string,
    reason: string,
    location: RevertLocation
): Promise<void> {
    const txn = await tx.loanTransaction.findFirst({
        where: { id: transactionDbId, type: 'SAVINGS_COLLECTION', isReversed: false, status: 'APPROVED' },
    });
    if (!txn) throw new Error('Loan advance collection transaction not found or already reversed');
    if (!txn.approvedAt) throw new Error('Transaction has no approval timestamp — cannot verify ordering');

    // Row lock: a concurrent revert of the same collection waits here and then sees
    // isReversed=true, so the balances below are decremented exactly once.
    const locked = await tx.$queryRaw<Array<{ isReversed: boolean }>>`
        SELECT "isReversed" FROM loan_transactions WHERE id = ${txn.id} FOR UPDATE`;
    if (locked[0]?.isReversed) {
        throw new Error('Loan advance collection transaction not found or already reversed');
    }

    const laterActivity = await findLaterUnreversedSavingsActivity(tx, txn.loanId, txn.id, txn.approvedAt);
    if (laterActivity) {
        throw new Error('Cannot revert — a later loan advance collection/refund exists on this loan; revert that first');
    }

    const eodError = await assertSameEodDay(tx, txn.branchId, txn.transactionDate);
    if (eodError) throw new Error(eodError);

    const allocationError = assertNotEodAllocated(txn.eodAllocatedAt);
    if (allocationError) throw new Error(allocationError);

    const amount = Number(txn.amount);

    const schedules = await tx.loanSchedule.findMany({
        where: { loanId: txn.loanId },
        select: { id: true, installmentNo: true, savingsPaid: true },
    });
    const scheduleRows = schedules.map((s) => ({
        id: s.id,
        installmentNo: s.installmentNo,
        savingsPaid: Number(s.savingsPaid || 0),
    }));
    const updates = withdrawSavingsDescending(scheduleRows, amount);
    for (const update of updates) {
        await tx.loanSchedule.update({
            where: { id: update.id },
            select: { id: true },
            data: { savingsPaid: update.newSavingsPaid },
        });
    }

    const loan = await tx.loan.findUnique({ where: { id: txn.loanId }, select: { savingsPaid: true } });
    const newLoanSavingsPaid = Math.max(0, Number(loan?.savingsPaid || 0) - amount);
    await tx.loan.update({
        where: { id: txn.loanId },
        select: { id: true },
        data: { savingsPaid: newLoanSavingsPaid },
    });

    const client = await tx.client.findUnique({ where: { id: txn.clientId }, select: { loanAdvance: true } });
    const newLoanAdvance = Math.max(0, Number(client?.loanAdvance || 0) - amount);
    await tx.client.update({
        where: { id: txn.clientId },
        select: { id: true },
        data: { loanAdvance: newLoanAdvance },
    });

    console.log(
        `[SavingsCollectionRevert] txnId=${txn.transactionId} loanId=${txn.loanId} amount=${amount} revertedBy=${userId} reason=${reason}`
    );

    await tx.loanTransaction.update({
        where: { id: txn.id },
        select: { id: true },
        data: {
            isReversed: true,
            revertedAt: new Date(),
            revertedById: userId,
            revertReason: reason,
            ...revertLocationColumns(location),
            remarks: txn.remarks ? `${txn.remarks}\n[REVERSED: ${reason}]` : `[REVERSED: ${reason}]`,
        },
    });

    // This cash was collected as part of a center meeting batch — pull it
    // back out of that batch's stored denomination too, so "Original Total"
    // and the auto-suggested note breakdown don't drift from what's
    // physically left after this revert (see Collection Revert dialog).
    if (txn.collectionBatchId) {
        const meeting = await tx.collectionMeetingRecord.findUnique({
            where: { collectionBatchId: txn.collectionBatchId },
        });
        if (meeting) {
            const corrected = subtractDenominationNotes(
                {
                    d500: meeting.d500, d200: meeting.d200, d100: meeting.d100, d50: meeting.d50,
                    d20: meeting.d20, d10: meeting.d10, d5: meeting.d5, d2: meeting.d2, d1: meeting.d1,
                },
                amount
            );
            await tx.collectionMeetingRecord.update({
                where: { collectionBatchId: txn.collectionBatchId },
                select: { id: true },
                data: {
                    ...corrected,
                    totalAmount: Math.max(0, Number(meeting.totalAmount) - amount),
                },
            });
        }
    }
}
