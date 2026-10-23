/**
 * Profit & Loss — pure transform over Trial Balance rows.
 *
 * The posting/branch/opening-date logic lives in computeTrialBalanceRows()
 * (app/api/reports/trial-balance/route.ts); this module only classifies those rows into
 * Income / Expenses and totals them, so the P&L reconciles with the Trial Balance by
 * construction. No DB or DOM access here — keep it importable from tests and exporters.
 *
 * All amounts are rounded to paise once per leg (integer arithmetic), then totals and the
 * net result are derived from those rounded rows so the screen, PDF, Excel and CSV agree.
 */

export type ProfitLossReportMode = 'AS_ON' | 'RANGE';

/** The subset of a Trial Balance row the P&L needs. */
export type TrialBalanceLikeRow = {
    groupPath: { groupId: string; groupName: string }[];
    ledgerCode: string;
    ledgerName: string;
    txnDebit: number;
    txnCredit: number;
};

export type ProfitLossAccount = {
    accountName: string;
    /** Kept as text — ledger codes are identifiers, not numbers. */
    accountCode: string;
    amount: number;
};

export type ProfitLossGroup = {
    /** e.g. "Direct Income", or "" when the ledger sits directly under the root group. */
    groupName: string;
    accounts: ProfitLossAccount[];
    total: number;
};

export type ProfitLossSection = {
    groups: ProfitLossGroup[];
    total: number;
};

export type ProfitLossMeta = {
    companyName: string;
    branchLabel: string;
    /** Branch code, or 'ALL' — used for download filenames. */
    branchCode: string;
    mode: ProfitLossReportMode;
    /** Effective inclusive window actually queried (YYYY-MM-DD). */
    fromDate: string;
    toDate: string;
    /** The date the user picked (As On mode) — equals toDate. */
    asOnDate?: string;
    generatedAt: string;
};

export type ProfitLossReport = {
    meta: ProfitLossMeta;
    expenses: ProfitLossSection;
    income: ProfitLossSection;
    totalExpenses: number;
    totalIncome: number;
    /** > 0 only when income exceeds expenses. Shown on the Expenses side. */
    netProfit: number;
    /** > 0 only when expenses exceed income. Shown on the Income side. */
    netLoss: number;
    /** Expenses side incl. net profit; always equals incomeSideTotal. */
    expenseSideTotal: number;
    /** Income side incl. net loss. */
    incomeSideTotal: number;
    /** Ledgers whose root group is neither Assets/Liabilities/Income/Expenses — excluded, surfaced for review. */
    unclassified: { accountName: string; accountCode: string; groupName: string }[];
};

const SYSTEM_INCOME_ROOT = 'G-INC';
const SYSTEM_EXPENSE_ROOT = 'G-EXP';
const BALANCE_SHEET_ROOTS = new Set(['G-ASSET', 'G-LIAB']);
const BALANCE_SHEET_ROOT_NAMES = new Set(['assets', 'asset', 'liabilities', 'liability']);

export const toPaise = (value: number | null | undefined): number =>
    value === null || value === undefined || !Number.isFinite(value) ? 0 : Math.round(value * 100);

export const fromPaise = (paise: number): number => paise / 100;

type RootKind = 'INCOME' | 'EXPENSE' | 'BALANCE_SHEET' | 'UNKNOWN';

function classifyRoot(root: { groupId: string; groupName: string } | undefined): RootKind {
    if (!root) return 'UNKNOWN';
    const name = root.groupName.trim().toLowerCase();
    if (root.groupId === SYSTEM_INCOME_ROOT || name === 'income') return 'INCOME';
    if (root.groupId === SYSTEM_EXPENSE_ROOT || name === 'expenses' || name === 'expense') return 'EXPENSE';
    if (BALANCE_SHEET_ROOTS.has(root.groupId) || BALANCE_SHEET_ROOT_NAMES.has(name)) return 'BALANCE_SHEET';
    return 'UNKNOWN';
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Start of the Indian financial year (1 April) containing `ymd`.
 * 2026-03-31 -> 2025-04-01, 2026-04-01 -> 2026-04-01.
 */
export function getFinancialYearStart(ymd: string): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    if (!m) throw new Error('Invalid date; expected YYYY-MM-DD');
    const year = Number(m[1]);
    const month = Number(m[2]);
    const startYear = month >= 4 ? year : year - 1;
    return `${startYear}-04-${pad(1)}`;
}

/** The effective inclusive window the P&L queries for the chosen mode. */
export function resolveProfitLossWindow(input: {
    mode: ProfitLossReportMode;
    fromDate?: string | null;
    toDate?: string | null;
    asOnDate?: string | null;
}): { fromDate: string; toDate: string } {
    if (input.mode === 'AS_ON') {
        if (!input.asOnDate) throw new Error('As On Date is required');
        return { fromDate: getFinancialYearStart(input.asOnDate), toDate: input.asOnDate };
    }
    if (!input.fromDate || !input.toDate) throw new Error('From Date and To Date are required');
    if (input.fromDate > input.toDate) throw new Error('From Date cannot be after To Date');
    return { fromDate: input.fromDate, toDate: input.toDate };
}

/**
 * Branch authorisation. `permitted === null` means unrestricted (Head Office).
 * Unlike resolveScopedBranchIds (which silently widens an unpermitted request back to the
 * user's full scope), a specific unpermitted branch is rejected outright.
 */
export function authorizeBranchSelection(
    permitted: string[] | null,
    requested: string | null | undefined,
): { ok: true; branchIds: string[] | null } | { ok: false; reason: string } {
    const wantsAll = !requested || requested === 'all';
    if (permitted === null) {
        return { ok: true, branchIds: wantsAll ? null : [requested as string] };
    }
    if (permitted.length === 0) return { ok: false, reason: 'No branches are assigned to your account' };
    if (wantsAll) return { ok: true, branchIds: permitted };
    if (!permitted.includes(requested as string)) return { ok: false, reason: 'You do not have access to the selected branch' };
    return { ok: true, branchIds: [requested as string] };
}

function emptySection(): ProfitLossSection {
    return { groups: [], total: 0 };
}

/** Income: credit-normal. Expenses: debit-normal. A contra (negative) row stays on its own side. */
export function buildProfitLoss(rows: TrialBalanceLikeRow[], meta: ProfitLossMeta): ProfitLossReport {
    type Bucket = { groupName: string; accounts: { accountName: string; accountCode: string; paise: number }[] };
    const incomeBuckets = new Map<string, Bucket>();
    const expenseBuckets = new Map<string, Bucket>();
    const unclassified: ProfitLossReport['unclassified'] = [];

    for (const row of rows) {
        const kind = classifyRoot(row.groupPath[0]);
        if (kind === 'BALANCE_SHEET') continue;
        if (kind === 'UNKNOWN') {
            unclassified.push({
                accountName: row.ledgerName,
                accountCode: row.ledgerCode,
                groupName: row.groupPath.map((g) => g.groupName).join(' > ') || 'UNCLASSIFIED',
            });
            continue;
        }

        const dr = toPaise(row.txnDebit);
        const cr = toPaise(row.txnCredit);
        const paise = kind === 'INCOME' ? cr - dr : dr - cr;

        // Everything below the root is the classification label (Direct/Indirect ... or deeper).
        const groupName = row.groupPath.slice(1).map((g) => g.groupName).join(' > ');
        const buckets = kind === 'INCOME' ? incomeBuckets : expenseBuckets;
        let bucket = buckets.get(groupName);
        if (!bucket) {
            bucket = { groupName, accounts: [] };
            buckets.set(groupName, bucket);
        }
        bucket.accounts.push({ accountName: row.ledgerName, accountCode: row.ledgerCode, paise });
    }

    const toSection = (buckets: Map<string, Bucket>): { section: ProfitLossSection; totalPaise: number } => {
        const section = emptySection();
        let totalPaise = 0;
        [...buckets.values()]
            .sort((a, b) => a.groupName.localeCompare(b.groupName))
            .forEach((bucket) => {
                bucket.accounts.sort((a, b) => a.accountName.localeCompare(b.accountName) || a.accountCode.localeCompare(b.accountCode));
                const groupPaise = bucket.accounts.reduce((s, a) => s + a.paise, 0);
                totalPaise += groupPaise;
                section.groups.push({
                    groupName: bucket.groupName,
                    accounts: bucket.accounts.map((a) => ({ accountName: a.accountName, accountCode: a.accountCode, amount: fromPaise(a.paise) })),
                    total: fromPaise(groupPaise),
                });
            });
        section.total = fromPaise(totalPaise);
        return { section, totalPaise };
    };

    const inc = toSection(incomeBuckets);
    const exp = toSection(expenseBuckets);
    const netPaise = inc.totalPaise - exp.totalPaise;
    const netProfitPaise = netPaise > 0 ? netPaise : 0;
    const netLossPaise = netPaise < 0 ? -netPaise : 0;

    return {
        meta,
        expenses: exp.section,
        income: inc.section,
        totalExpenses: fromPaise(exp.totalPaise),
        totalIncome: fromPaise(inc.totalPaise),
        netProfit: fromPaise(netProfitPaise),
        netLoss: fromPaise(netLossPaise),
        expenseSideTotal: fromPaise(exp.totalPaise + netProfitPaise),
        incomeSideTotal: fromPaise(inc.totalPaise + netLossPaise),
        unclassified,
    };
}

/** Lowercase, [a-z0-9_-] only — safe for Content-Disposition / download names. */
export function sanitizeFilenamePart(value: string): string {
    return value.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'report';
}

export function profitLossFilenameBase(report: ProfitLossReport): string {
    const { meta } = report;
    const period = meta.mode === 'AS_ON' ? `AsOn_${meta.toDate}` : `${meta.fromDate}_to_${meta.toDate}`;
    return `ProfitLoss_${sanitizeFilenamePart(meta.branchCode || 'ALL')}_${period}`;
}
