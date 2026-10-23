/**
 * Loan Closure Revert — schedule status recompute.
 *
 * The forward closure flow (app/api/collections/loan-writeoff-closure/route.ts)
 * blindly overwrites every PENDING/OVERDUE/PARTIALLY_PAID schedule's status to
 * CLOSED without recording what it was before. There is nothing to "restore"
 * on revert — the correct status has to be recomputed from the schedule's own
 * paid/due amounts, which were never touched by the closure. This mirrors the
 * same paid-vs-due formula already used by the foreclosure revert in
 * app/api/collections/delete-foreclosure/route.ts, so both revert flows agree
 * on what a schedule's status should look like after its paid amounts change.
 */
export function recomputeScheduleStatus(totalPaid: number, totalDue: number): 'PENDING' | 'PARTIALLY_PAID' | 'PAID' {
    if (totalPaid <= 0) return 'PENDING';
    if (totalPaid < totalDue) return 'PARTIALLY_PAID';
    return 'PAID';
}
