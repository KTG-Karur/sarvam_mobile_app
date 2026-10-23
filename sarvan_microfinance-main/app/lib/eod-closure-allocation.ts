import type { Prisma } from '@prisma/client';

/**
 * Pre-Closure (PRECLOSURE) and Loan Closing (WRITEOFF) collections — mirrors how
 * REPAYMENT already works: approval/creation immediately finalizes the loan
 * (schedules, balances, isActive:false — see finalizeClosureCoveredLoan in
 * app/lib/foreclosure-workflow.ts, called from the Foreclosure approve route and the
 * Loan Write-Off/Death Closure creation route), and "Allocate for EOD" is purely a
 * later GL-voucher-posting step (accounting-posting.service.ts's
 * postEodClosureAllocation / postEodFunderAllocation).
 *
 * Pure, DB-free helpers — no Prisma client access here, easy to unit test.
 */

export type ClosureType = 'PRECLOSURE' | 'WRITEOFF';

const CLOSURE_MARKER_PREFIX: Record<ClosureType, string> = {
  PRECLOSURE: '[POSTING:EOD_PRECLOSURE:',
  WRITEOFF: '[POSTING:EOD_WRITEOFF:',
};

/** One bucket per funder/date/closureType — Gold and Normal collections for the same funder
 *  share this marker (gold is a loan-type flag, not a separate funder; see buildFunderLabel
 *  in app/lib/gl-config.ts). */
export function buildEodClosureMarker(
  branchId: string,
  workingDateYmd: string,
  funderKey: string,
  closureType: ClosureType
): string {
  return `${CLOSURE_MARKER_PREFIX[closureType]}${branchId}:${workingDateYmd}:${funderKey}]`;
}

/**
 * Eligibility filter for a PRECLOSURE/WRITEOFF LoanTransaction to be picked up by
 * "Allocate for EOD": approved, not reversed, not yet allocated, and — critically —
 * not already posted by the legacy `set-gl-balance` ("GL Sync") utility, which still
 * independently posts PRECLOSURE rows via its own isGlSynced-based mechanism. Without
 * the isGlSynced:false guard, a row that utility already posted could be posted a
 * second time here.
 *
 * No `loan.isActive` check — unlike REPAYMENT's own pending-collection query, which
 * has never needed one either, the loan is already closed (isActive:false) by the
 * time a PRECLOSURE/WRITEOFF row can reach this filter (finalization happens at
 * approval/creation time — see finalizeClosureCoveredLoan), so requiring isActive:true
 * here would incorrectly exclude every genuinely-pending row. `eodAllocatedAt: null`
 * plus `isGlSynced: false` are the only idempotency signals needed.
 */
export function pendingClosureAllocationWhere(
  branchId: string,
  closureType: ClosureType,
  dayStartUtc: Date,
  dayEndExclusiveUtc: Date,
  funderId: string | null
): Prisma.LoanTransactionWhereInput {
  return {
    branchId,
    type: closureType,
    status: 'APPROVED',
    isReversed: false,
    eodAllocatedAt: null,
    isGlSynced: false,
    transactionDate: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
    loan: { funderId: funderId ?? null },
  };
}

/**
 * Raw (non-negated) "this loan has an approved-but-not-yet-allocated PRECLOSURE/WRITEOFF
 * transaction" condition. Exported separately from excludePendingClosureAllocationWhere so
 * call sites that already have their own top-level `NOT` clause (e.g. the death-marking
 * exclusion in demand/arrear/bulk-collection/single-collection routes) can compose both
 * conditions into a single `NOT: [condA, condB]` array instead of spreading two `NOT` keys
 * into one object — the second would silently overwrite the first.
 */
export function pendingClosureAllocationLoanCondition(): Prisma.LoanWhereInput {
  return {
    transactions: {
      some: {
        type: { in: ['PRECLOSURE', 'WRITEOFF'] },
        status: 'APPROVED',
        isReversed: false,
        eodAllocatedAt: null,
      },
    },
  };
}

/**
 * Excludes loans that have an approved-but-not-yet-allocated PRECLOSURE/WRITEOFF
 * transaction sitting on them. Belt-and-suspenders at this point: loan finalization
 * (isActive:false, disbursementStatus, schedules) now happens at approval/creation
 * time, in the same transaction as the closure transaction itself, so any other
 * eligibility query's own `isActive:true` check already excludes such a loan the
 * moment the closure is approved/created — this guard mainly protects the narrow
 * window inside that same transaction. Spread into the `where` of any loan-eligibility
 * query that has no pre-existing `NOT` key (if one exists already, use
 * pendingClosureAllocationLoanCondition() inside a `NOT: [...]` array instead — see
 * the comment on that function).
 */
export function excludePendingClosureAllocationWhere(): Prisma.LoanWhereInput {
  return { NOT: pendingClosureAllocationLoanCondition() };
}
