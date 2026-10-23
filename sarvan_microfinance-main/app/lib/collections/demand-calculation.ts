/**
 * Pure calculation functions for demand collection financial breakdown.
 *
 * Separates schedule-level remaining amounts into:
 *   - Arrears (past-due installments)
 *   - Current Demand (today's installment)
 *
 * All amounts are rounded to 2 decimal places (paisa precision).
 */

// Type-only import — erased at compile time, so this file stays free of any
// runtime Prisma client dependency. Needed so NON_OUTSTANDING_SCHEDULE_STATUSES
// keeps its literal `ScheduleStatus[]` typing instead of widening to `string[]`,
// which would break every Prisma `status: { notIn: ... }` call site that uses it.
import type { ScheduleStatus } from '@prisma/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DemandBreakdownInput = {
  principalRemaining: number;
  interestRemaining: number;
  feesRemaining: number;
  penaltiesRemaining: number;
  isOverdue: boolean;
};

export type DemandBreakdown = {
  arrearPrincipal: number;
  arrearInterest: number;
  currentDemandPrincipal: number;
  currentDemandInterest: number;
  fees: number;
  penalty: number;
  totalDemand: number;
};

export type CollectionAllocationInput = {
  amount: number;
  arrearInterest: number;
  arrearPrincipal: number;
  currentDemandInterest: number;
  currentDemandPrincipal: number;
  fees: number;
  penalty: number;
};

export type CollectionAllocation = {
  appliedPenalty: number;
  appliedFees: number;
  appliedArrearInterest: number;
  appliedArrearPrincipal: number;
  appliedCurrentInterest: number;
  appliedCurrentPrincipal: number;
  totalApplied: number;
  remainingAmount: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// Schedule status filter (shared by every collection page's schedule query)
// ---------------------------------------------------------------------------

/**
 * LoanSchedule statuses to exclude when fetching schedules for arrear/current-
 * demand calculations. Deliberately an EXCLUDE-list of only the two truly
 * final, no-longer-collectible statuses — rather than an include-list of
 * PENDING/OVERDUE/PARTIALLY_PAID (the previous pattern across every collection
 * route). `status` is a cached/derived label (set at approval or reversal
 * time) and can drift out of sync with a schedule's actual
 * principalDue/interestDue vs. principalPaid/interestPaid amounts — seen in
 * production where a reversal recomputed status against a stale `totalDue`
 * and flipped a schedule to PAID while it still carried a real outstanding
 * balance. Filtering the query down to the include-list silently drops that
 * row's remaining amount from every arrear/demand total it should have been
 * part of. Every caller already ignores a schedule whose *actual* remaining
 * amount (due − paid) is zero, so including PAID rows here is a no-op for
 * genuinely-settled installments and only changes behavior for the
 * mismarked ones — which is the point.
 */
export const NON_OUTSTANDING_SCHEDULE_STATUSES: ScheduleStatus[] = ['WAIVED', 'CLOSED'];

// ---------------------------------------------------------------------------
// Demand Breakdown
// ---------------------------------------------------------------------------

/**
 * Classify a single schedule row's remaining amounts into arrear or current
 * demand buckets. A row is either fully arrear or fully current — never both.
 *
 * Fees and penalties are NOT classified as arrear/current because they apply
 * at the schedule level regardless of timing.
 *
 * totalDemand = arrearPrincipal + arrearInterest
 *             + currentDemandPrincipal + currentDemandInterest
 *             + fees + penalty
 */
export function classifyDemandBreakdown(
  input: DemandBreakdownInput,
): DemandBreakdown {
  const {
    principalRemaining,
    interestRemaining,
    feesRemaining,
    penaltiesRemaining,
    isOverdue,
  } = input;

  const arrearPrincipal = isOverdue ? round2(principalRemaining) : 0;
  const arrearInterest = isOverdue ? round2(interestRemaining) : 0;
  const currentDemandPrincipal = isOverdue ? 0 : round2(principalRemaining);
  const currentDemandInterest = isOverdue ? 0 : round2(interestRemaining);
  const fees = round2(feesRemaining);
  const penalty = round2(penaltiesRemaining);

  const totalDemand = round2(
    arrearPrincipal +
      arrearInterest +
      currentDemandPrincipal +
      currentDemandInterest +
      fees +
      penalty,
  );

  return {
    arrearPrincipal,
    arrearInterest,
    currentDemandPrincipal,
    currentDemandInterest,
    fees,
    penalty,
    totalDemand,
  };
}

// ---------------------------------------------------------------------------
// Collection Allocation
// ---------------------------------------------------------------------------

/**
 * Allocate a collected amount across demand components with priority:
 *   1. Penalty
 *   2. Fees
 *   3. Arrear Interest
 *   4. Arrear Principal
 *   5. Current Demand Interest
 *   6. Current Demand Principal
 *
 * This mirrors legacy microfinance collection order where arrear interest
 * is recovered before arrear principal, and arrears before current demand.
 */
export function allocateCollectionAmount(
  input: CollectionAllocationInput,
): CollectionAllocation {
  let remaining = round2(Math.max(0, input.amount));

  const appliedPenalty = Math.min(remaining, round2(input.penalty));
  remaining = round2(remaining - appliedPenalty);

  const appliedFees = Math.min(remaining, round2(input.fees));
  remaining = round2(remaining - appliedFees);

  const appliedArrearInterest = Math.min(
    remaining,
    round2(input.arrearInterest),
  );
  remaining = round2(remaining - appliedArrearInterest);

  const appliedArrearPrincipal = Math.min(
    remaining,
    round2(input.arrearPrincipal),
  );
  remaining = round2(remaining - appliedArrearPrincipal);

  const appliedCurrentInterest = Math.min(
    remaining,
    round2(input.currentDemandInterest),
  );
  remaining = round2(remaining - appliedCurrentInterest);

  const appliedCurrentPrincipal = Math.min(
    remaining,
    round2(input.currentDemandPrincipal),
  );
  remaining = round2(remaining - appliedCurrentPrincipal);

  const totalApplied = round2(
    appliedPenalty +
      appliedFees +
      appliedArrearInterest +
      appliedArrearPrincipal +
      appliedCurrentInterest +
      appliedCurrentPrincipal,
  );

  return {
    appliedPenalty: round2(appliedPenalty),
    appliedFees: round2(appliedFees),
    appliedArrearInterest: round2(appliedArrearInterest),
    appliedArrearPrincipal: round2(appliedArrearPrincipal),
    appliedCurrentInterest: round2(appliedCurrentInterest),
    appliedCurrentPrincipal: round2(appliedCurrentPrincipal),
    totalApplied,
    remainingAmount: round2(remaining),
  };
}

// ---------------------------------------------------------------------------
// Pending-collection netting
// ---------------------------------------------------------------------------

/**
 * Nets a schedule's gross remaining components (due - paid) against amounts
 * already staged via any still-PENDING (not yet approved) transaction lines,
 * regardless of how long they've been awaiting approval. APPROVED lines must
 * NOT be passed in here — they are already reflected in `*Paid`, so including
 * them again would double-count. A REJECTED line is naturally excluded by
 * callers (they only query `status: 'PENDING'`), which is what makes a
 * rejected collection's amount available again automatically.
 */
export type NetScheduleComponentsInput = {
  principalDue: number;
  principalPaid: number;
  interestDue: number;
  interestPaid: number;
  feesDue: number;
  feesPaid: number;
  penaltiesDue: number;
  penaltiesPaid: number;
  pendingPrincipal: number;
  pendingInterest: number;
  pendingFees: number;
  pendingPenalty: number;
};

export type NetScheduleComponents = {
  netPrincipal: number;
  netInterest: number;
  netFees: number;
  netPenalties: number;
};

export function netScheduleComponents(
  input: NetScheduleComponentsInput,
): NetScheduleComponents {
  const principalRemaining = input.principalDue - input.principalPaid;
  const interestRemaining = input.interestDue - input.interestPaid;
  const feesRemaining = input.feesDue - input.feesPaid;
  const penaltiesRemaining = input.penaltiesDue - input.penaltiesPaid;

  return {
    netPrincipal: round2(Math.max(0, principalRemaining - input.pendingPrincipal)),
    netInterest: round2(Math.max(0, interestRemaining - input.pendingInterest)),
    netFees: round2(Math.max(0, feesRemaining - input.pendingFees)),
    netPenalties: round2(Math.max(0, penaltiesRemaining - input.pendingPenalty)),
  };
}

/**
 * Distributes a loan-level "today's pending Loan Advance (savings)" budget
 * across a loan's schedules, in the same ascending-dueDate order the
 * approval flow (app/api/collections/approve/route.ts) uses when an
 * approved SAVINGS_COLLECTION payment is actually posted to `savingsPaid`.
 * Loan Advance is intentionally never netted against principal/interest.
 */
export type SavingsScheduleInput = {
  scheduleId: string;
  savingsDue: number;
  savingsPaid: number;
  isOverdue: boolean;
};

export type SavingsScheduleResult = {
  scheduleId: string;
  netSavingsArrear: number;
  netSavingsCurrent: number;
};

export type ApplySavingsBudgetResult = {
  schedules: SavingsScheduleResult[];
  remainingBudget: number;
};

// ---------------------------------------------------------------------------
// Demand Sheet EOD-cutoff reconciliation
// ---------------------------------------------------------------------------

/**
 * Resolves the effective arrear/current-demand cutoff date for a Demand Sheet report.
 *
 * Demand Sheet's `dateStr` is a free-form, user-picked date (reprinting a past sheet,
 * planning a future one, or viewing "today"), unlike PAR/MIS-Agewise-Arrear which always
 * report "as of right now" and can unconditionally anchor to the branch's live EOD-processed
 * working date. Reconciling against the branch's working date must therefore only happen
 * when the viewed date IS today — otherwise a historical reprint would pick up arrears from
 * installments that hadn't even occurred yet as of that historical date (branchWorkingYmd is
 * always "now", not "as of dateStr").
 *
 * - Viewing today, EOD already advanced the branch past today → cutoff bumps forward to the
 *   branch's real working date, so a due-today-but-unpaid installment correctly reclassifies
 *   from Current Demand to Arrear.
 * - Viewing today, EOD not yet run → branchWorkingYmd === dateStr, so this is a no-op.
 * - Any other dateStr (past reprint or future planning) → unchanged, byte-for-byte.
 */
export function resolveDemandSheetEffectiveCutoffYmd(
  dateStr: string,
  todayYmd: string,
  branchWorkingYmd: string | null,
): string {
  if (dateStr !== todayYmd) return dateStr;
  if (!branchWorkingYmd) return dateStr;
  return branchWorkingYmd > dateStr ? branchWorkingYmd : dateStr;
}

export function applySavingsBudget(
  schedulesAscByDueDate: SavingsScheduleInput[],
  budget: number,
): ApplySavingsBudgetResult {
  let remainingBudget = round2(Math.max(0, budget));
  const schedules: SavingsScheduleResult[] = [];

  for (const schedule of schedulesAscByDueDate) {
    const savingsGross = round2(Math.max(0, schedule.savingsDue - schedule.savingsPaid));
    const appliedFromBudget = Math.min(remainingBudget, savingsGross);
    remainingBudget = round2(remainingBudget - appliedFromBudget);
    const savingsNet = round2(Math.max(0, savingsGross - appliedFromBudget));

    schedules.push({
      scheduleId: schedule.scheduleId,
      netSavingsArrear: schedule.isOverdue ? savingsNet : 0,
      netSavingsCurrent: schedule.isOverdue ? 0 : savingsNet,
    });
  }

  return { schedules, remainingBudget: round2(remainingBudget) };
}

/**
 * Current demand for an installment falling due on the cutoff day: the installment's principal/interest
 * minus whatever was already paid on EARLIER days (advance). Same-day collections are deliberately not
 * subtracted — they are today's collection against the demand, not a reduction of the day's target.
 */
export function netCurrentDemand(
  due: { principalDue: number; interestDue: number },
  advancePaid: { principal: number; interest: number },
): { principal: number; interest: number } {
  return {
    principal: round2(Math.max(0, due.principalDue - advancePaid.principal)),
    interest: round2(Math.max(0, due.interestDue - advancePaid.interest)),
  };
}
