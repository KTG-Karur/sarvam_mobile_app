/**
 * Balance Sheet — pure transform over Trial Balance (AS_ON) rows.
 *
 * Posting, approval, branch opening-date and self-account logic all live in
 * computeTrialBalanceRows() (app/api/reports/trial-balance/route.ts); its AS_ON `closing*`
 * figures are the cumulative balance (seeded opening + postings up to the date), which is
 * what a balance sheet needs. This module only classifies and rolls those balances up.
 *
 * Sign convention: Liabilities are shown credit-positive, Assets debit-positive. A contra
 * balance stays on its own side as a negative number — never flipped to the other side.
 * Income/Expense roots are not listed; their cumulative net is shown as one Profit & Loss
 * line (Liabilities side for profit, Assets side for loss). The app has no year-end closing
 * entry, so that figure is cumulative, not current-financial-year only.
 *
 * No DB or DOM access — importable from tests and exporters.
 */

export type BalanceSheetMode = 'GROUP' | 'ACCOUNT';

export type BalanceSheetRow = {
    groupPath: { groupId: string; groupName: string }[];
    ledgerCode: string;
    ledgerName: string;
    closingDebit: number;
    closingCredit: number;
};

export type BsLineStyle = 'group' | 'ledger' | 'subtotal' | 'net' | 'total' | 'blank';
export type BsLine = {
    label: string;
    /** Group id for group rows, ledger code for ledger rows. Text — never numeric. */
    code: string;
    amount: number | null;
    style: BsLineStyle;
    depth: number;
};

export type BalanceSheetMeta = {
    companyName: string;
    branchLabel: string;
    branchCode: string;
    mode: BalanceSheetMode;
    asOnDate: string;
    generatedAt: string;
};

export type BalanceSheetReport = {
    meta: BalanceSheetMeta;
    /** Body lines per side (no padding, no grand total). */
    liabilities: BsLine[];
    assets: BsLine[];
    /** Σ liabilities-side groups (before the P&L line). */
    liabilitiesSubtotal: number;
    assetsSubtotal: number;
    netProfit: number;
    netLoss: number;
    totalLiabilities: number;
    totalAssets: number;
    /** totalAssets − totalLiabilities. Non-zero means the books do not reconcile; never hidden. */
    difference: number;
    isBalanced: boolean;
    unclassified: { accountName: string; accountCode: string; groupName: string }[];
};

type Kind = 'ASSET' | 'LIABILITY' | 'INCOME' | 'EXPENSE' | 'UNKNOWN';

function classifyRoot(root: { groupId: string; groupName: string } | undefined): Kind {
    if (!root) return 'UNKNOWN';
    const name = root.groupName.trim().toLowerCase();
    if (root.groupId === 'G-ASSET' || name === 'assets' || name === 'asset') return 'ASSET';
    if (root.groupId === 'G-LIAB' || name === 'liabilities' || name === 'liability') return 'LIABILITY';
    if (root.groupId === 'G-INC' || name === 'income') return 'INCOME';
    if (root.groupId === 'G-EXP' || name === 'expenses' || name === 'expense') return 'EXPENSE';
    return 'UNKNOWN';
}

const toPaise = (v: number | null | undefined): number => (v === null || v === undefined || !Number.isFinite(v) ? 0 : Math.round(v * 100));
const fromPaise = (p: number): number => p / 100;

type Node = {
    groupId: string;
    groupName: string;
    children: Map<string, Node>;
    ledgers: { name: string; code: string; paise: number }[];
};

const newNode = (groupId: string, groupName: string): Node => ({ groupId, groupName, children: new Map(), ledgers: [] });

function insert(root: Node, path: { groupId: string; groupName: string }[], ledger: Node['ledgers'][number]) {
    let node = root;
    for (const seg of path) {
        let next = node.children.get(seg.groupId);
        if (!next) {
            next = newNode(seg.groupId, seg.groupName);
            node.children.set(seg.groupId, next);
        }
        node = next;
    }
    node.ledgers.push(ledger);
}

function nodeTotal(node: Node): number {
    let t = node.ledgers.reduce((s, l) => s + l.paise, 0);
    node.children.forEach((c) => { t += nodeTotal(c); });
    return t;
}

const byName = (a: Node, b: Node) => a.groupName.localeCompare(b.groupName);

function emitNode(node: Node, depth: number, mode: BalanceSheetMode, out: BsLine[]): void {
    const total = fromPaise(nodeTotal(node));
    const kids = [...node.children.values()].sort(byName);
    const ledgers = [...node.ledgers].sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));

    if (mode === 'ACCOUNT') {
        out.push({ label: node.groupName, code: node.groupId, amount: null, style: 'group', depth });
        ledgers.forEach((l) => out.push({ label: l.name, code: l.code, amount: fromPaise(l.paise), style: 'ledger', depth: depth + 1 }));
        kids.forEach((k) => emitNode(k, depth + 1, mode, out));
        out.push({ label: `Total ${node.groupName}`, code: '', amount: total, style: 'subtotal', depth });
        return;
    }

    // GROUP mode: one summarised row per group, never a ledger row.
    if (kids.length === 0) {
        out.push({ label: node.groupName, code: node.groupId, amount: total, style: 'group', depth });
        return;
    }
    out.push({ label: node.groupName, code: node.groupId, amount: null, style: 'group', depth });
    if (ledgers.length > 0) {
        // Ledgers filed directly on a group that also has sub-groups: one aggregate row, so the group total still adds up.
        out.push({ label: `${node.groupName} - Others`, code: '', amount: fromPaise(ledgers.reduce((s, l) => s + l.paise, 0)), style: 'group', depth: depth + 1 });
    }
    kids.forEach((k) => emitNode(k, depth + 1, mode, out));
    out.push({ label: `Total ${node.groupName}`, code: '', amount: total, style: 'subtotal', depth });
}

export function buildBalanceSheet(rows: BalanceSheetRow[], meta: BalanceSheetMeta): BalanceSheetReport {
    const liabRoot = newNode('LIAB', 'Liabilities');
    const assetRoot = newNode('ASSET', 'Assets');
    let plNetDebitPaise = 0; // Σ(income + expense) debit-positive; profit = −this
    const unclassified: BalanceSheetReport['unclassified'] = [];

    for (const row of rows) {
        const kind = classifyRoot(row.groupPath[0]);
        const netDebit = toPaise(row.closingDebit) - toPaise(row.closingCredit);
        if (kind === 'INCOME' || kind === 'EXPENSE') {
            plNetDebitPaise += netDebit;
        } else if (kind === 'ASSET') {
            insert(assetRoot, row.groupPath.slice(1), { name: row.ledgerName, code: row.ledgerCode, paise: netDebit });
        } else if (kind === 'LIABILITY') {
            insert(liabRoot, row.groupPath.slice(1), { name: row.ledgerName, code: row.ledgerCode, paise: -netDebit });
        } else {
            unclassified.push({
                accountName: row.ledgerName,
                accountCode: row.ledgerCode,
                groupName: row.groupPath.map((g) => g.groupName).join(' > ') || 'UNCLASSIFIED',
            });
        }
    }

    const emitSide = (root: Node): BsLine[] => {
        const out: BsLine[] = [];
        // Ledgers directly under the root (no sub-group) are shown under the root's own name.
        if (root.ledgers.length > 0) {
            const direct = newNode(root.groupId, root.groupName);
            direct.ledgers = root.ledgers;
            emitNode(direct, 0, meta.mode, out);
        }
        [...root.children.values()].sort(byName).forEach((c) => emitNode(c, 0, meta.mode, out));
        return out;
    };

    const liabilities = emitSide(liabRoot);
    const assets = emitSide(assetRoot);
    const liabilitiesSubtotalPaise = nodeTotal(liabRoot);
    const assetsSubtotalPaise = nodeTotal(assetRoot);

    const profitPaise = -plNetDebitPaise;
    const netProfitPaise = profitPaise > 0 ? profitPaise : 0;
    const netLossPaise = profitPaise < 0 ? -profitPaise : 0;
    if (netProfitPaise > 0) liabilities.push({ label: 'Profit & Loss A/c (Net Profit)', code: '', amount: fromPaise(netProfitPaise), style: 'net', depth: 0 });
    if (netLossPaise > 0) assets.push({ label: 'Profit & Loss A/c (Net Loss)', code: '', amount: fromPaise(netLossPaise), style: 'net', depth: 0 });

    const totalLiabPaise = liabilitiesSubtotalPaise + netProfitPaise;
    const totalAssetPaise = assetsSubtotalPaise + netLossPaise;
    const diffPaise = totalAssetPaise - totalLiabPaise;

    return {
        meta,
        liabilities,
        assets,
        liabilitiesSubtotal: fromPaise(liabilitiesSubtotalPaise),
        assetsSubtotal: fromPaise(assetsSubtotalPaise),
        netProfit: fromPaise(netProfitPaise),
        netLoss: fromPaise(netLossPaise),
        totalLiabilities: fromPaise(totalLiabPaise),
        totalAssets: fromPaise(totalAssetPaise),
        difference: fromPaise(diffPaise),
        isBalanced: diffPaise === 0,
        unclassified,
    };
}

const BLANK: BsLine = { label: '', code: '', amount: null, style: 'blank', depth: 0 };

/** Side-by-side lines (Liabilities | Assets) padded to equal length, ending in the Total row. Shared by screen, PDF and Excel. */
export function buildBalanceSheetLines(report: BalanceSheetReport): { left: BsLine[]; right: BsLine[] } {
    const left = [...report.liabilities];
    const right = [...report.assets];
    const len = Math.max(left.length, right.length);
    while (left.length < len) left.push(BLANK);
    while (right.length < len) right.push(BLANK);
    left.push({ label: 'Total Liabilities', code: '', amount: report.totalLiabilities, style: 'total', depth: 0 });
    right.push({ label: 'Total Assets', code: '', amount: report.totalAssets, style: 'total', depth: 0 });
    return { left, right };
}

export const balanceSheetModeLabel = (mode: BalanceSheetMode): string => (mode === 'GROUP' ? 'Group Account Wise' : 'Account Wise');

/** Same rule as authorizeBranchSelection in profit-loss.ts is reused by the route; filename only here. */
export function balanceSheetFilenameBase(report: BalanceSheetReport): string {
    const safe = (v: string) => v.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'report';
    return `BalanceSheet_${safe(report.meta.branchCode || 'ALL')}_${report.meta.asOnDate}_${report.meta.mode === 'GROUP' ? 'GroupWise' : 'AccountWise'}`;
}
