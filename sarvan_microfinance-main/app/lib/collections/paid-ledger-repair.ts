/**
 * Pure helpers for repairing LoanSchedule paid amounts that exceed what the approved,
 * non-reversed LoanTransactionLine ledger actually recorded (a collection approval that was
 * applied twice — see claim-pending-transaction.ts). Used by scripts/fix-double-applied-collections.ts.
 *
 * Only ever LOWERS a component, and only when it is above the ledger: a schedule whose paid
 * amount is below the ledger (or has no ledger because it was migrated/backed up) is left alone.
 */

export type ScheduleForRepair = {
  principalDue: number;
  interestDue: number;
  feesDue: number;
  penaltiesDue: number;
  principalPaid: number;
  interestPaid: number;
  feesPaid: number;
  penaltiesPaid: number;
  paidAt: Date | null;
};

export type LedgerPaid = {
  principal: number;
  interest: number;
  fees: number;
  penalty: number;
};

export type ScheduleRepair = {
  principalPaid: number;
  interestPaid: number;
  feesPaid: number;
  penaltiesPaid: number;
  totalPaid: number;
  status: 'PAID' | 'PARTIALLY_PAID' | 'PENDING';
  paidAt: Date | null;
  /** Amounts removed from the schedule; subtract the same from the loan-level totals. */
  removed: LedgerPaid;
};

const EPS = 0.005;

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Same PAID / PARTIALLY_PAID rule as the collection approval route (principal+interest+fees+penalties). */
export function statusFromAmounts(totalPaid: number, totalDue: number): ScheduleRepair['status'] {
  if (totalPaid >= totalDue - EPS && totalDue > 0) return 'PAID';
  if (totalPaid > EPS) return 'PARTIALLY_PAID';
  return 'PENDING';
}

/** Returns the corrected schedule state, or null when no component is above its ledger amount. */
export function computeScheduleRepair(schedule: ScheduleForRepair, ledger: LedgerPaid): ScheduleRepair | null {
  const principalPaid = Math.min(schedule.principalPaid, ledger.principal);
  const interestPaid = Math.min(schedule.interestPaid, ledger.interest);
  const feesPaid = Math.min(schedule.feesPaid, ledger.fees);
  const penaltiesPaid = Math.min(schedule.penaltiesPaid, ledger.penalty);

  const removed: LedgerPaid = {
    principal: round2(schedule.principalPaid - principalPaid),
    interest: round2(schedule.interestPaid - interestPaid),
    fees: round2(schedule.feesPaid - feesPaid),
    penalty: round2(schedule.penaltiesPaid - penaltiesPaid),
  };
  if (removed.principal <= EPS && removed.interest <= EPS && removed.fees <= EPS && removed.penalty <= EPS) {
    return null;
  }

  const totalPaid = round2(principalPaid + interestPaid + feesPaid + penaltiesPaid);
  const totalDue = schedule.principalDue + schedule.interestDue + schedule.feesDue + schedule.penaltiesDue;
  const status = statusFromAmounts(totalPaid, totalDue);

  return {
    principalPaid: round2(principalPaid),
    interestPaid: round2(interestPaid),
    feesPaid: round2(feesPaid),
    penaltiesPaid: round2(penaltiesPaid),
    totalPaid,
    status,
    paidAt: status === 'PAID' ? schedule.paidAt : null,
    removed,
  };
}
