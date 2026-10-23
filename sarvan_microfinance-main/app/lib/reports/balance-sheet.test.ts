import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx-js-style';

vi.mock('@/app/lib/reports/pdf-report-header', () => ({ drawPdfReportHeader: vi.fn() }));

import {
    balanceSheetFilenameBase,
    buildBalanceSheet,
    buildBalanceSheetLines,
    type BalanceSheetMeta,
    type BalanceSheetMode,
    type BalanceSheetRow,
} from '@/app/lib/reports/balance-sheet';
import { buildBalanceSheetWorkbook } from '@/app/lib/reports/balance-sheet-export';

const ASSET = { groupId: 'G-ASSET', groupName: 'Assets' };
const LIAB = { groupId: 'G-LIAB', groupName: 'Liabilities' };
const INC = { groupId: 'G-INC', groupName: 'Income' };
const EXP = { groupId: 'G-EXP', groupName: 'Expenses' };
const CUR_ASSET = { groupId: 'G-ASSET-CUR', groupName: 'Current Assets' };
const CUR_LIAB = { groupId: 'G-LIAB-CUR', groupName: 'Current Liabilities' };

const meta = (mode: BalanceSheetMode): BalanceSheetMeta => ({
    companyName: 'Test Trust',
    branchLabel: '43 - Sivakasi',
    branchCode: '43',
    mode,
    asOnDate: '2026-10-17',
    generatedAt: '17/10/2026',
});

const row = (path: { groupId: string; groupName: string }[], code: string, name: string, dr: number, cr: number): BalanceSheetRow => ({
    groupPath: path, ledgerCode: code, ledgerName: name, closingDebit: dr, closingCredit: cr,
});

// Balanced books: Cash 1000 + Loans 9000 (assets) = Capital 5000 + HO 4500 (liabilities) + profit 500.
// Profit 500 = income 800 − expense 300.
const balanced: BalanceSheetRow[] = [
    row([ASSET, CUR_ASSET], '007', 'Cash in Hand', 1000, 0),
    row([ASSET, CUR_ASSET], '103', 'Loan Portfolio', 9000, 0),
    row([LIAB, CUR_LIAB], '4', 'Head Office', 0, 4500),
    row([LIAB, { groupId: 'G-LIAB-CAP', groupName: 'Capital' }], '9', 'Trust Capital', 0, 5000),
    row([INC, { groupId: 'G-INC-IND', groupName: 'Indirect Income' }], '1', 'Doc Charges', 0, 800),
    row([EXP, { groupId: 'G-EXP-IND', groupName: 'Indirect Expenses' }], '2', 'Rent', 300, 0),
];

describe('buildBalanceSheet — reconciliation', () => {
    it('Assets = Liabilities + P&L when the trial balance balances', () => {
        const r = buildBalanceSheet(balanced, meta('ACCOUNT'));
        expect(r.totalAssets).toBe(10000);
        expect(r.netProfit).toBe(500);
        expect(r.totalLiabilities).toBe(10000);
        expect(r.difference).toBe(0);
        expect(r.isBalanced).toBe(true);
    });

    it('net loss goes on the Assets side', () => {
        const r = buildBalanceSheet(
            [row([ASSET, CUR_ASSET], '1', 'Cash', 700, 0), row([LIAB, CUR_LIAB], '2', 'HO', 0, 1000), row([EXP, { groupId: 'x', groupName: 'X' }], '3', 'Rent', 300, 0)],
            meta('GROUP'),
        );
        expect(r.netLoss).toBe(300);
        expect(r.totalAssets).toBe(1000);
        expect(r.totalLiabilities).toBe(1000);
        expect(r.assets.at(-1)?.label).toMatch(/Net Loss/);
    });

    it('reports a genuine discrepancy instead of hiding it', () => {
        const r = buildBalanceSheet([row([ASSET, CUR_ASSET], '1', 'Cash', 1000, 0), row([LIAB, CUR_LIAB], '2', 'HO', 0, 900)], meta('GROUP'));
        expect(r.difference).toBe(100);
        expect(r.isBalanced).toBe(false);
        expect(r.liabilities.some((l) => l.style === 'net')).toBe(false); // no dummy balancing line
    });

    it('keeps contra balances on their own side as negatives', () => {
        const r = buildBalanceSheet([row([ASSET, CUR_ASSET], '1', 'Bank OD', 0, 250), row([ASSET, CUR_ASSET], '2', 'Cash', 1000, 0)], meta('ACCOUNT'));
        expect(r.assets.find((l) => l.label === 'Bank OD')?.amount).toBe(-250);
        expect(r.totalAssets).toBe(750);
    });

    it('excludes unrecognised roots and reports them', () => {
        const r = buildBalanceSheet([row([{ groupId: 'UNCLASSIFIED', groupName: 'UNCLASSIFIED' }], '7', 'Mystery', 5, 0)], meta('GROUP'));
        expect(r.unclassified).toHaveLength(1);
        expect(r.totalAssets).toBe(0);
    });

    it('handles an empty trial balance', () => {
        const r = buildBalanceSheet([], meta('GROUP'));
        expect(r.liabilities).toEqual([]);
        expect(r.isBalanced).toBe(true);
    });

    it('sums without float drift', () => {
        const rows = Array.from({ length: 10 }, (_, i) => row([ASSET, CUR_ASSET], String(i), `L${i}`, 0.1, 0));
        expect(buildBalanceSheet(rows, meta('GROUP')).totalAssets).toBe(1);
    });
});

describe('modes', () => {
    it('GROUP mode: one row per group, no ledger rows', () => {
        const r = buildBalanceSheet(balanced, meta('GROUP'));
        expect(r.assets.filter((l) => l.style === 'ledger')).toEqual([]);
        expect(r.assets).toEqual([{ label: 'Current Assets', code: 'G-ASSET-CUR', amount: 10000, style: 'group', depth: 0 }]);
        expect(r.liabilities.map((l) => l.label)).toEqual(['Capital', 'Current Liabilities', 'Profit & Loss A/c (Net Profit)']);
    });

    it('ACCOUNT mode: group heading, indented ledgers, subtotal that equals the group row', () => {
        const r = buildBalanceSheet(balanced, meta('ACCOUNT'));
        expect(r.assets.map((l) => [l.style, l.label, l.depth])).toEqual([
            ['group', 'Current Assets', 0],
            ['ledger', 'Cash in Hand', 1],
            ['ledger', 'Loan Portfolio', 1],
            ['subtotal', 'Total Current Assets', 0],
        ]);
        const subtotal = r.assets.find((l) => l.style === 'subtotal')?.amount;
        const group = buildBalanceSheet(balanced, meta('GROUP')).assets[0].amount;
        expect(subtotal).toBe(group);
        expect(subtotal).toBe(r.assets.filter((l) => l.style === 'ledger').reduce((s, l) => s + (l.amount ?? 0), 0));
    });

    it('nested groups roll up into the parent total in both modes', () => {
        const nested: BalanceSheetRow[] = [
            row([ASSET, { groupId: 'FA', groupName: 'Fixed Assets' }, { groupId: 'FA-B', groupName: 'Buildings' }], '1', 'Office', 500, 0),
            row([ASSET, { groupId: 'FA', groupName: 'Fixed Assets' }], '2', 'Furniture', 200, 0),
        ];
        const g = buildBalanceSheet(nested, meta('GROUP'));
        expect(g.assets.find((l) => l.label === 'Total Fixed Assets')?.amount).toBe(700);
        expect(g.assets.find((l) => l.label === 'Fixed Assets - Others')?.amount).toBe(200);
        expect(g.assets.filter((l) => l.style === 'ledger')).toEqual([]);
        const a = buildBalanceSheet(nested, meta('ACCOUNT'));
        expect(a.assets.find((l) => l.label === 'Total Fixed Assets')?.amount).toBe(700);
        expect(g.totalAssets).toBe(700);
        expect(a.totalAssets).toBe(700);
    });

    it('a group with several ledgers is aggregated once', () => {
        const g = buildBalanceSheet(balanced, meta('GROUP'));
        expect(g.assets.filter((l) => l.label === 'Current Assets')).toHaveLength(1);
    });
});

describe('shared lines and exports', () => {
    it('side-by-side lines are equal length and end with the totals', () => {
        const { left, right } = buildBalanceSheetLines(buildBalanceSheet(balanced, meta('ACCOUNT')));
        expect(left).toHaveLength(right.length);
        expect(left.at(-1)).toMatchObject({ label: 'Total Liabilities', amount: 10000 });
        expect(right.at(-1)).toMatchObject({ label: 'Total Assets', amount: 10000 });
    });

    it('Excel: amounts are numeric cells, codes stay text with leading zeros', () => {
        const wb = buildBalanceSheetWorkbook(buildBalanceSheet(balanced, meta('ACCOUNT')));
        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        const ws = XLSX.read(buf, { type: 'buffer' }).Sheets['Balance Sheet'];
        const cells = Object.entries(ws).filter(([k]) => /^[A-Z]+\d+$/.test(k)) as [string, XLSX.CellObject][];
        const find = (v: string | number) => cells.find(([, c]) => c.v === v)?.[1];
        expect(find(1000)?.t).toBe('n');
        expect(find(10000)?.t).toBe('n');
        expect(find(500)?.t).toBe('n');
        expect(find('007')?.t).toBe('s');
        expect(cells.filter(([, c]) => c.t === 's' && /^[₹\d,]+\.\d{2}$/.test(String(c.v)))).toEqual([]);
    });

    it('filename is sanitised and mode-specific', () => {
        const r = buildBalanceSheet([], { ...meta('GROUP'), branchCode: '4/3 ../x' });
        expect(balanceSheetFilenameBase(r)).toBe('BalanceSheet_4_3_x_2026-10-17_GroupWise');
    });
});
