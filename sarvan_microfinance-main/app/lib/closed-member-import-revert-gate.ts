import { prisma } from '@/app/lib/prisma';

/** Same one-week, IST-based revert window as uploan-import-revert-gate.ts. */
export { isWithinRevertWindow } from '@/app/lib/uploan-import-revert-gate';

/**
 * A closed-member-import row is unsafe to revert once a human has acted on what it
 * auto-created: an approved/rejected SavingsRefundRequest, an approved/rejected
 * GoldTransaction(GIVE), OR (same signal the ongoing-loan importer's gate uses) a real,
 * non-migrated LoanTransaction on the loan. Any one of those means reverting would either
 * silently undo a decision AM/Admin already made, or delete a loan that's since picked up
 * real activity. Returns the loanIds carrying any of those signals, so revert can skip
 * (not delete) those specific rows while reverting the rest of the job normally.
 */
export async function findClosedMemberRowsWithPostImportActivity(
    rows: { loanId: string | null }[]
): Promise<Set<string>> {
    const loanIds = rows.map((r) => r.loanId).filter((id): id is string => !!id);
    if (loanIds.length === 0) return new Set();

    const [realActivity, actedSavingsRequests, actedGoldReturns] = await Promise.all([
        prisma.loanTransaction.findMany({
            where: { loanId: { in: loanIds }, excludeFromEodAllocation: false },
            select: { loanId: true },
            distinct: ['loanId'],
        }),
        prisma.savingsRefundRequest.findMany({
            // reviewedAt (not status) is the "has a human decided on this at least once"
            // signal — status alone isn't reliable any more since a Loan Advance Refund
            // revert now moves an approved request's status back to PENDING_APPROVAL (see
            // app/api/savings/refund/revert/route.ts), which would otherwise make a
            // genuinely-acted-on-then-reverted request look untouched again. reviewedAt is
            // set once at first approval/rejection and is never cleared by that revert.
            where: { loanId: { in: loanIds }, reviewedAt: { not: null } },
            select: { loanId: true },
            distinct: ['loanId'],
        }),
        prisma.goldTransaction.findMany({
            where: { loanId: { in: loanIds }, type: 'GIVE', status: { not: 'PENDING' } },
            select: { loanId: true },
            distinct: ['loanId'],
        }),
    ]);

    const unsafe = new Set<string>();
    for (const r of realActivity) unsafe.add(r.loanId);
    for (const r of actedSavingsRequests) unsafe.add(r.loanId);
    for (const r of actedGoldReturns) unsafe.add(r.loanId);
    return unsafe;
}
