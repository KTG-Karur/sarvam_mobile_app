import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx-js-style';

// Exporter imports the browser PDF header; the pure builders under test never call it.
vi.mock('@/app/lib/reports/pdf-report-header', () => ({ drawPdfReportHeader: vi.fn() }));

import {
    authorizeBranchSelection,
    buildProfitLoss,
    getFinancialYearStart,
    profitLossFilenameBase,
    resolveProfitLossWindow,
    type ProfitLossMeta,
    type TrialBalanceLikeRow,
} from '@/app/lib/reports/profit-loss';
import { buildProfitLossCsv, buildProfitLossWorkbook } from '@/app/lib/reports/profit-loss-export';

const INC = { groupId: 'G-INC', groupName: 'Income' };
const EXP = { groupId: 'G-EXP', groupName: 'Expenses' };
const meta: ProfitLossMeta = {
    companyName: 'Test Trust',
    branchLabel: '43 - Sivakasi',
    branchCode: '43',
    mode: 'RANGE',
    fromDate: '2026-04-01',
    toDate: '2026-10-31',
    generatedAt: '17/10/2026, 10:00:00 am',
};

const row = (path: { groupId: string; groupName: string }[], code: string, name: string, dr: number, cr: number): TrialBalanceLikeRow => ({
    groupPath: path,
    ledgerCode: code,
    ledgerName: name,
    txnDebit: dr,
    txnCredit: cr,
});

const sample = [
    row([INC, { groupId: 'G-INC-DIR', groupName: 'Direct Income' }], '101', 'Interest Income', 0, 25000.5),
    row([INC, { groupId: 'G-INC-IND', groupName: 'Indirect Income' }], '5', 'Document Charge Income', 0, 1200.25),
    row([EXP, { groupId: 'G-EXP-IND', groupName: 'Indirect Expenses' }], '201', 'Rent, "HO" Expense', 12500.1, 0),
    row([{ groupId: 'G-ASSET', groupName: 'Assets' }, { groupId: 'G-ASSET-CUR', groupName: 'Current Assets' }], '100', 'Cash in Hand', 90000, 1000),
];

describe('getFinancialYearStart', () => {
    it('31 March belongs to the previous FY', () => expect(getFinancialYearStart('2026-03-31')).toBe('2025-04-01'));
    it('1 April starts a new FY', () => expect(getFinancialYearStart('2026-04-01')).toBe('2026-04-01'));
    it('December stays in the same year', () => expect(getFinancialYearStart('2026-12-31')).toBe('2026-04-01'));
    it('rejects bad input', () => expect(() => getFinancialYearStart('31-03-2026')).toThrow());
});

describe('resolveProfitLossWindow', () => {
    it('AS_ON spans FY start to the chosen date', () => {
        expect(resolveProfitLossWindow({ mode: 'AS_ON', asOnDate: '2026-10-17' })).toEqual({ fromDate: '2026-04-01', toDate: '2026-10-17' });
    });
    it('RANGE passes through and rejects inverted ranges', () => {
        expect(resolveProfitLossWindow({ mode: 'RANGE', fromDate: '2026-05-01', toDate: '2026-05-31' })).toEqual({ fromDate: '2026-05-01', toDate: '2026-05-31' });
        expect(() => resolveProfitLossWindow({ mode: 'RANGE', fromDate: '2026-06-01', toDate: '2026-05-31' })).toThrow();
    });
});

describe('authorizeBranchSelection', () => {
    it('rejects a branch outside the permitted set instead of widening to all', () => {
        expect(authorizeBranchSelection(['a', 'b'], 'c')).toMatchObject({ ok: false });
    });
    it('All Branches covers every permitted branch, not just the primary', () => {
        expect(authorizeBranchSelection(['a', 'b'], 'all')).toEqual({ ok: true, branchIds: ['a', 'b'] });
    });
    it('accepts a permitted branch', () => {
        expect(authorizeBranchSelection(['a', 'b'], 'b')).toEqual({ ok: true, branchIds: ['b'] });
    });
    it('Head Office (null) is unrestricted', () => {
        expect(authorizeBranchSelection(null, 'all')).toEqual({ ok: true, branchIds: null });
        expect(authorizeBranchSelection(null, 'x')).toEqual({ ok: true, branchIds: ['x'] });
    });
    it('rejects users with no branches', () => {
        expect(authorizeBranchSelection([], 'all')).toMatchObject({ ok: false });
    });
});

describe('buildProfitLoss', () => {
    it('classifies by root group, ignores balance-sheet ledgers, computes net profit', () => {
        const r = buildProfitLoss(sample, meta);
        expect(r.totalIncome).toBe(26200.75);
        expect(r.totalExpenses).toBe(12500.1);
        expect(r.netProfit).toBe(13700.65);
        expect(r.netLoss).toBe(0);
        expect(r.expenseSideTotal).toBe(r.incomeSideTotal);
        expect(r.income.groups.map((g) => g.groupName)).toEqual(['Direct Income', 'Indirect Income']);
        expect(r.unclassified).toEqual([]);
    });

    it('expenses exceeding income yields a net loss on the income side', () => {
        const r = buildProfitLoss([row([EXP], '9', 'Salary', 5000, 0), row([INC], '1', 'Fee', 0, 2000)], meta);
        expect(r.netLoss).toBe(3000);
        expect(r.netProfit).toBe(0);
        expect(r.incomeSideTotal).toBe(5000);
        expect(r.expenseSideTotal).toBe(5000);
    });

    it('empty period gives zero totals', () => {
        const r = buildProfitLoss([], meta);
        expect(r).toMatchObject({ totalIncome: 0, totalExpenses: 0, netProfit: 0, netLoss: 0, expenseSideTotal: 0, incomeSideTotal: 0 });
    });

    it('keeps zero-net accounts that had gross movement and negative contra rows on their own side', () => {
        const r = buildProfitLoss([row([INC], '1', 'Fee', 100, 100), row([INC], '2', 'Refund adj', 50, 0)], meta);
        expect(r.income.groups[0].accounts.map((a) => a.amount)).toEqual([0, -50]);
        expect(r.totalIncome).toBe(-50);
        expect(r.netLoss).toBe(0 + 50);
    });

    it('flags ledgers under an unrecognised root as unclassified and excludes them', () => {
        const r = buildProfitLoss([row([{ groupId: 'UNCLASSIFIED', groupName: 'UNCLASSIFIED' }], '7', 'Mystery', 0, 99)], meta);
        expect(r.unclassified).toHaveLength(1);
        expect(r.totalIncome).toBe(0);
    });

    it('row amounts sum exactly to totals (no float drift)', () => {
        const rows = Array.from({ length: 10 }, (_, i) => row([INC], String(i), `L${i}`, 0, 0.1));
        const r = buildProfitLoss(rows, meta);
        expect(r.totalIncome).toBe(1);
        expect(r.income.groups[0].accounts.reduce((s, a) => s + Math.round(a.amount * 100), 0)).toBe(100);
    });

    it('same account code in different groups stays on separate rows', () => {
        const r = buildProfitLoss([row([INC, { groupId: 'a', groupName: 'A' }], '1', 'X', 0, 10), row([INC, { groupId: 'b', groupName: 'B' }], '1', 'X', 0, 20)], meta);
        expect(r.income.groups).toHaveLength(2);
        expect(r.totalIncome).toBe(30);
    });
});

describe('exports', () => {
    const report = buildProfitLoss(sample, meta);

    it('Excel: amounts are numeric cells, codes are text', () => {
        const wb = buildProfitLossWorkbook(report);
        const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        const ws = XLSX.read(buf, { type: 'buffer' }).Sheets['Profit & Loss'];
        const cells = Object.entries(ws).filter(([k]) => /^[A-Z]+\d+$/.test(k)) as [string, XLSX.CellObject][];
        const find = (v: string | number) => cells.find(([, c]) => c.v === v)?.[1];

        expect(find(25000.5)?.t).toBe('n');
        expect(find(13700.65)?.t).toBe('n');
        expect(find(12500.1)?.t).toBe('n');
        expect(find('101')?.t).toBe('s');
        expect(find('Interest Income')?.t).toBe('s');
        // No amount-looking text cells at all.
        const textAmounts = cells.filter(([, c]) => c.t === 's' && /^[₹\d,]+\.\d{2}$/.test(String(c.v)));
        expect(textAmounts).toEqual([]);
    });

    it('CSV: plain 2-dp numbers, no currency symbol or thousands separators, escapes text', () => {
        const csv = buildProfitLossCsv(report);
        expect(csv).toContain('Income,Direct Income,Interest Income,101,25000.50');
        expect(csv).toContain('Expenses,Indirect Expenses,"Rent, ""HO"" Expense",201,12500.10');
        expect(csv).toContain('Summary,,Net Profit,,13700.65');
        expect(csv).not.toContain('₹');
        expect(csv).not.toMatch(/\d,\d{3}\.\d{2}/);
        expect(csv).toContain('Branch,43 - Sivakasi');
    });

    it('CSV neutralises formula-leading text', () => {
        const r = buildProfitLoss([row([INC], '1', '=SUM(A1)', 0, 5)], meta);
        expect(buildProfitLossCsv(r)).toContain("'=SUM(A1)");
    });

    it('filename is sanitised', () => {
        expect(profitLossFilenameBase({ ...report, meta: { ...meta, branchCode: '4/3 ../x' } })).toBe('ProfitLoss_4_3_x_2026-04-01_to_2026-10-31');
    });
});
