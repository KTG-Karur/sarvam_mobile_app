import type { Prisma } from '@prisma/client';

type BranchScopedWhere = Pick<Prisma.FinancialTransactionWhereInput, 'OR'>;

/**
 * Branch scoping for FinancialTransaction.
 *
 * Use this wherever you previously filtered by `createdBy.branchId`.
 * Prefer explicit `FinancialTransaction.branchId`, with a legacy fallback
 * for historical rows where branchId is null.
 */
export function buildFinancialTransactionBranchScope(params: {
  branchId?: string | string[] | null;
  includeLegacyCreatedByFallback?: boolean;
}): BranchScopedWhere | {} {
  const raw = params.branchId ?? null;
  const branchIds = Array.isArray(raw) ? raw.filter(Boolean) : raw ? [raw] : [];
  if (branchIds.length === 0) return {};

  const branchCond = branchIds.length === 1
    ? { branchId: branchIds[0] }
    : { branchId: { in: branchIds } };

  const includeLegacy = params.includeLegacyCreatedByFallback ?? true;
  if (!includeLegacy) {
    return { OR: [branchCond] };
  }

  const legacyCond = branchIds.length === 1
    ? { branchId: null, createdBy: { branchId: branchIds[0] } }
    : { branchId: null, createdBy: { branchId: { in: branchIds } } };

  return {
    OR: [branchCond, legacyCond],
  };
}

