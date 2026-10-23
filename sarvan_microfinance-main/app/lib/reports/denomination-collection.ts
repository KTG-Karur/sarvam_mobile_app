import { prisma } from '@/app/lib/prisma';
import { Prisma } from '@prisma/client';
import { parseDenominationEntryDateUtc } from '@/app/lib/branch-financial-day';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';

export const DENOMINATION_COLLECTION_KEYS = [
  '500',
  '200',
  '100',
  '50',
  '20',
  '10',
  'coins',
] as const;

export type DenominationCollectionKey = (typeof DENOMINATION_COLLECTION_KEYS)[number];

export type DenominationCollectionSummary = {
  totalAmount: number;
  denominations: Record<DenominationCollectionKey, number>;
};

export type DenominationCollectionDailyRow = {
  date: string; // YYYY-MM-DD
  total: number;
} & Record<DenominationCollectionKey, number>;

export type DenominationCollectionReport = {
  summary: DenominationCollectionSummary;
  dailyBreakdown: DenominationCollectionDailyRow[];
};

type ReportUser = {
  userId: string;
  role: string;
  branchId?: string | null;
};

export function parseYmdOrThrow(label: string, ymd: string): Date {
  try {
    return parseDenominationEntryDateUtc(ymd);
  } catch {
    throw new Error(`${label} must be in YYYY-MM-DD format`);
  }
}

export function assertValidDateRange(fromDate: Date, toDate: Date) {
  if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) {
    throw new Error('Invalid date range');
  }
  if (fromDate > toDate) {
    throw new Error('fromDate must be <= toDate');
  }
}

function emptyDenominations(): Record<DenominationCollectionKey, number> {
  return {
    '500': 0,
    '200': 0,
    '100': 0,
    '50': 0,
    '20': 0,
    '10': 0,
    coins: 0,
  };
}

function toNumber(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

type SqlTotalsRow = {
  d500: unknown;
  d200: unknown;
  d100: unknown;
  d50: unknown;
  d20: unknown;
  d10: unknown;
  coins: unknown;
  total: unknown;
};

type SqlDailyRow = SqlTotalsRow & { entryDate: Date };

function buildWhereClause(input: {
  branchIds: string[] | null;
  fromDate: Date;
  toDate: Date;
}) {
  return input.branchIds
    ? Prisma.sql`WHERE "branchId" IN (${Prisma.join(input.branchIds)}) AND "entryDate" >= ${input.fromDate} AND "entryDate" <= ${input.toDate}`
    : Prisma.sql`WHERE "entryDate" >= ${input.fromDate} AND "entryDate" <= ${input.toDate}`;
}

function buildTotalsQuery(input: { branchIds: string[] | null; fromDate: Date; toDate: Date }) {
  const where = buildWhereClause(input);
  return Prisma.sql`
    SELECT
      COALESCE(SUM(d500  *  500), 0) AS d500,
      COALESCE(SUM(d200  *  200), 0) AS d200,
      COALESCE(SUM(d100  *  100), 0) AS d100,
      COALESCE(SUM(d50   *   50), 0) AS d50,
      COALESCE(SUM(d20   *   20), 0) AS d20,
      COALESCE(SUM(d10   *   10), 0) AS d10,
      COALESCE(SUM(d5 * 5 + d2 * 2 + d1 * 1), 0) AS coins,
      COALESCE(SUM("totalAmount"), 0) AS total
    FROM denomination_entries
    ${where};
  `;
}

function buildDailyQuery(input: { branchIds: string[] | null; fromDate: Date; toDate: Date }) {
  const where = buildWhereClause(input);
  return Prisma.sql`
    SELECT
      "entryDate" AS "entryDate",
      COALESCE(SUM(d500  *  500), 0) AS d500,
      COALESCE(SUM(d100  *  100), 0) AS d100,
      COALESCE(SUM(d200  *  200), 0) AS d200,
      COALESCE(SUM(d50   *   50), 0) AS d50,
      COALESCE(SUM(d20   *   20), 0) AS d20,
      COALESCE(SUM(d10   *   10), 0) AS d10,
      COALESCE(SUM(d5 * 5 + d2 * 2 + d1 * 1), 0) AS coins,
      COALESCE(SUM("totalAmount"), 0) AS total
    FROM denomination_entries
    ${where}
    GROUP BY "entryDate"
    ORDER BY "entryDate" ASC;
  `;
}

/**
 * Role-agnostic branch scope resolution — covers BM, AM, FDO, and any custom
 * RBAC role via `getPermittedBranchIds` (AreaManagerBranch for AM,
 * UserBranchAssignment for everyone else). "All" means all of THIS user's
 * assigned branches, not company-wide, unless they're unrestricted (ADMIN /
 * HO-based), in which case a specific request is honored and no request means
 * a genuine company-wide view.
 */
async function resolveBranchScope(
  user: ReportUser,
  branchIdParam: string | null
): Promise<{ branchIds: string[] | null; mode: 'single' | 'all' }> {
  const permittedBranchIds = await getPermittedBranchIds(user);

  if (permittedBranchIds === null) {
    if (branchIdParam && branchIdParam !== 'all') {
      return { branchIds: [branchIdParam], mode: 'single' };
    }
    return { branchIds: null, mode: 'all' };
  }

  if (permittedBranchIds.length === 0) {
    throw new Error('Branch not assigned to this user');
  }

  if (branchIdParam && branchIdParam !== 'all') {
    if (!permittedBranchIds.includes(branchIdParam)) {
      throw new Error('Invalid branch selection');
    }
    return { branchIds: [branchIdParam], mode: 'single' };
  }

  return { branchIds: permittedBranchIds, mode: 'all' };
}

export async function getDenominationCollectionReport(input: {
  fromDateYmd: string;
  toDateYmd: string;
  branchIdParam: string | null;
  user: ReportUser;
  /**
   * Lets a caller that already resolved branch scope through some other path
   * (e.g. the Request Report background worker, via resolveScopedBranchIds at
   * request-creation time) skip this module's own per-role resolveBranchScope
   * — undefined (the default) preserves the original per-request behavior.
   */
  preResolvedBranchIds?: string[] | null;
}): Promise<DenominationCollectionReport> {
  const fromDate = parseYmdOrThrow('fromDate', input.fromDateYmd);
  const toDate = parseYmdOrThrow('toDate', input.toDateYmd);
  assertValidDateRange(fromDate, toDate);

  const branchIds = input.preResolvedBranchIds !== undefined
    ? input.preResolvedBranchIds
    : (await resolveBranchScope(input.user, input.branchIdParam)).branchIds;
  const sqlInput = { branchIds, fromDate, toDate };
  const totalsQuery = buildTotalsQuery(sqlInput);
  const dailyQuery = buildDailyQuery(sqlInput);

  const [totalsRows, dailyRows] = await Promise.all([
    prisma.$queryRaw<SqlTotalsRow[]>(totalsQuery),
    prisma.$queryRaw<SqlDailyRow[]>(dailyQuery),
  ]);

  const totals = totalsRows[0] ?? {
    d500: 0,
    d200: 0,
    d100: 0,
    d50: 0,
    d20: 0,
    d10: 0,
    coins: 0,
    total: 0,
  };

  const summaryDenoms = emptyDenominations();
  summaryDenoms['500'] = toNumber(totals.d500);
  summaryDenoms['100'] = toNumber(totals.d100);
  summaryDenoms['200'] = toNumber(totals.d200);
  summaryDenoms['50'] = toNumber(totals.d50);
  summaryDenoms['20'] = toNumber(totals.d20);
  summaryDenoms['10'] = toNumber(totals.d10);
  summaryDenoms.coins = toNumber(totals.coins);

  const dailyBreakdown: DenominationCollectionDailyRow[] = dailyRows.map((r) => ({
    date: r.entryDate.toISOString().slice(0, 10),
    '500': toNumber(r.d500),
    '100': toNumber(r.d100),
    '200': toNumber(r.d200),
    '50': toNumber(r.d50),
    '20': toNumber(r.d20),
    '10': toNumber(r.d10),
    coins: toNumber(r.coins),
    total: toNumber(r.total),
  }));

  return {
    summary: {
      totalAmount: toNumber(totals.total),
      denominations: summaryDenoms,
    },
    dailyBreakdown,
  };
}

