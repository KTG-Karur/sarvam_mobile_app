/**
 * Bumps a schedule's *Paid fields in-memory by amounts already reserved via a
 * PENDING (not yet approved) collection — WITHOUT writing anything to the DB.
 * This lets read-only remaining-due calculations (computeDueWindow,
 * allocateTransactionLines, etc.) treat a pending collection as if it were
 * already paid, purely for display/validation purposes, while the actual
 * LoanSchedule row stays untouched until Branch Manager approval (unchanged
 * behavior — see app/api/collections/approve/route.ts).
 */

import type { PendingScheduleComponents } from './pending-schedule-amounts';

export function applyPendingToSchedule<
    T extends {
        principalPaid: number;
        interestPaid: number;
        feesPaid: number;
        penaltiesPaid: number;
    }
>(schedule: T, pending?: PendingScheduleComponents): T {
    if (!pending) return schedule;
    return {
        ...schedule,
        principalPaid: schedule.principalPaid + pending.principal,
        interestPaid: schedule.interestPaid + pending.interest,
        feesPaid: schedule.feesPaid + pending.fees,
        penaltiesPaid: schedule.penaltiesPaid + pending.penalty,
    };
}
