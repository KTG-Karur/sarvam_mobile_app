import { describe, it, expect } from 'vitest';
import {
    computeGridRow, resolvePercentAmount, roundRupee, setGridEdit, isGridEditEmpty,
    type GridComponent, type GridRowBase,
} from './payroll-grid';

// The org's Payroll excel sheet: PF = 12% of Actual Basic capped at 1,800;
// ESI = 0.75% of Actual Gross, only when Month CTC Pay <= 21,000.
const components: GridComponent[] = [
    { id: 'basic', salaryId: 1, name: 'Basic', type: 'EARNINGS', kind: 'BASIC', amount: 0 },
    { id: 'hra', salaryId: 2, name: 'HRA', type: 'EARNINGS', kind: 'HRA', amount: 0 },
    { id: 'arrear', salaryId: 3, name: 'Arrear Salary', type: 'EARNINGS', kind: 'FREE', amount: 0 },
    { id: 'incentive', salaryId: 4, name: 'Monthly Incentive', type: 'EARNINGS', kind: 'FREE', amount: 0 },
    { id: 'pf', salaryId: 5, name: 'PF', type: 'DEDUCTIONS', kind: 'PERCENT', amount: 0, percentRule: { percent: 12, basis: 'BASIC', maxAmount: 1800, ctcEligibilityLimit: null } },
    { id: 'esi', salaryId: 6, name: 'ESI', type: 'DEDUCTIONS', kind: 'PERCENT', amount: 0, percentRule: { percent: 0.75, basis: 'GROSS', maxAmount: null, ctcEligibilityLimit: 21000 } },
    { id: 'other', salaryId: 7, name: 'Other Deductions', type: 'DEDUCTIONS', kind: 'FREE', amount: 0 },
    { id: 'loan', salaryId: 8, name: 'Staff Loan', type: 'DEDUCTIONS', kind: 'FREE', amount: 0, systemBacked: true },
    { id: 'advance', salaryId: 9, name: 'Staff Advance', type: 'DEDUCTIONS', kind: 'FREE', amount: 0, systemBacked: true },
];

const base = (monthlyCtc: number, lopDays: number): GridRowBase => ({
    totalPaidDays: 30, lopDays, monthlyCtc, basicPercent: 70, hraPercent: 30, components,
});

describe('computeGridRow — matches the org Payroll excel rows', () => {
    it('row 3: CTC 85,000, no LOP — PF capped at 1,800, no ESI above 21,000 CTC', () => {
        const r = computeGridRow(base(85000, 0));
        expect(r.proratedCtc).toBe(85000);
        expect(r.actualGross).toBe(85000);
        expect(r.actualBasic).toBe(59500);
        expect(r.actualHra).toBe(25500);
        expect(r.amounts.pf).toBe(1800);
        expect(r.amounts.esi).toBe(0);
        expect(r.totalDeductions).toBe(1800);
        expect(r.netWithIncentive).toBe(83200);
        expect(r.netPay).toBe(83200);
    });

    it('row 5: CTC 11,550 — PF 970 (970.2) and ESI 87 (86.625) are whole rupees', () => {
        const r = computeGridRow(base(11550, 0));
        expect(r.amounts.pf).toBe(970);
        expect(r.amounts.esi).toBe(87);
        expect(r.totalDeductions).toBe(1057);
        expect(r.netWithIncentive).toBe(10493);
    });

    it('row 8: 3 LOP days — prorated on /30 (27/30), PF 832, ESI 74', () => {
        const r = computeGridRow(base(11000, 3));
        expect(r.workingDays).toBe(27);
        expect(r.actualGross).toBe(9900);
        expect(r.actualBasic).toBe(6930);
        expect(r.amounts.pf).toBe(832);
        expect(r.amounts.esi).toBe(74);
        expect(r.netWithIncentive).toBe(8994);
    });

    it('row 12: 14 working days, CTC 29,700 — ESI stays 0 because CTC (not the prorated gross) is above 21,000', () => {
        const r = computeGridRow(base(29700, 16));
        expect(r.workingDays).toBe(14);
        expect(r.actualGross).toBe(13860);
        expect(r.actualBasic).toBe(9702);
        expect(r.amounts.pf).toBe(1164);
        expect(r.amounts.esi).toBe(0);
        expect(r.netWithIncentive).toBe(12696);
    });

    it('row 13: PF hits the 1,800 cap on a 22,050 Actual Basic', () => {
        const r = computeGridRow(base(35000, 3));
        expect(r.actualGross).toBe(31500);
        expect(r.amounts.pf).toBe(1800);
        expect(r.netWithIncentive).toBe(29700);
    });

    it('row 14: CTC 18,000 — PF 1,512 and ESI 135', () => {
        const r = computeGridRow(base(18000, 0));
        expect(r.amounts.pf).toBe(1512);
        expect(r.amounts.esi).toBe(135);
        expect(r.netWithIncentive).toBe(16353);
    });

    it('row 4: 4 LOP days on 100,000 — Actual Gross 86,667', () => {
        expect(computeGridRow(base(100000, 4)).actualGross).toBe(86667);
    });
});

describe('computeGridRow — edits and downstream recalculation', () => {
    it('Net Pay = Net With Incentive - Monthly Incentive', () => {
        const r = computeGridRow(base(18000, 0), { components: { incentive: 2000 } });
        expect(r.incentive).toBe(2000);
        expect(r.totalEarnings).toBe(20000);
        expect(r.netWithIncentive).toBe(20000 - 1647);
        expect(r.netPay).toBe(20000 - 1647 - 2000);
    });

    it('editing LOP re-flows Gross -> Basic/HRA -> PF/ESI -> totals', () => {
        const r = computeGridRow(base(18000, 0), { lopDays: 3 });
        expect(r.actualGross).toBe(16200);
        expect(r.actualBasic).toBe(11340);
        expect(r.amounts.pf).toBe(1361); // 12% of 11,340 = 1,360.8
        expect(r.amounts.esi).toBe(122); // 0.75% of 16,200 = 121.5
    });

    it('editing Total Paid Days re-prorates Month CTC (S = ROUND(N/30*P)), then Gross = ROUND(T/30*S) exactly like the sheet', () => {
        const r = computeGridRow(base(30000, 0), { totalPaidDays: 28 });
        expect(r.proratedCtc).toBe(28000);
        expect(r.workingDays).toBe(28);
        expect(r.actualGross).toBe(26133); // 28/30 * 28,000
    });

    it('an explicit PF override wins over the rule; Basic/HRA overrides flow into totals', () => {
        const r = computeGridRow(base(18000, 0), { components: { pf: 500 }, actualBasic: 10000, actualHra: 8000 });
        expect(r.amounts.pf).toBe(500);
        expect(r.amounts.basic).toBe(10000);
        expect(r.amounts.hra).toBe(8000);
        expect(r.totalEarnings).toBe(18000);
    });

    it('an edited Actual Gross drives Actual Basic / HRA and the percent deductions', () => {
        const r = computeGridRow(base(18000, 0), { actualGross: 10000 });
        expect(r.actualBasic).toBe(7000);
        expect(r.actualHra).toBe(3000);
        expect(r.amounts.pf).toBe(840);
        expect(r.amounts.esi).toBe(75);
    });

    it('editing Month CTC above the ESI limit zeroes ESI', () => {
        expect(computeGridRow(base(18000, 0), { monthlyCtc: 25000 }).amounts.esi).toBe(0);
    });
});

describe('resolvePercentAmount / roundRupee', () => {
    it('rounds half up at a .5 boundary despite float noise', () => {
        expect(roundRupee(74.5)).toBe(75);
        expect(roundRupee(0.1 + 0.2 + 74.2)).toBe(75); // float noise around 74.5 must not round down
        expect(roundRupee(74.4)).toBe(74);
    });

    it('returns 0 above the CTC eligibility limit and applies the cap otherwise', () => {
        const rule = { percent: 12, basis: 'BASIC' as const, actualBasic: 20000, actualGross: 28000, maxAmount: 1800 };
        expect(resolvePercentAmount({ ...rule, monthlyCtc: 30000, ctcEligibilityLimit: 21000 })).toBe(0);
        expect(resolvePercentAmount({ ...rule, monthlyCtc: 20000, ctcEligibilityLimit: 21000 })).toBe(1800);
    });
});

describe('setGridEdit / isGridEditEmpty', () => {
    it('sets and clears scalar and component edits without mutating the input', () => {
        const start = {};
        const a = setGridEdit(start, 'lopDays', 2);
        const b = setGridEdit(a, 'c:pf', 500);
        expect(start).toEqual({});
        expect(b).toEqual({ lopDays: 2, components: { pf: 500 } });
        const c = setGridEdit(setGridEdit(b, 'c:pf', null), 'lopDays', null);
        expect(c).toEqual({});
        expect(isGridEditEmpty(c)).toBe(true);
        expect(isGridEditEmpty(undefined)).toBe(true);
        expect(isGridEditEmpty(b)).toBe(false);
    });
});
