import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
    user: { findUnique: vi.fn() },
    salaryComponent: { findMany: vi.fn() },
    employeeSalaryMaster: { findMany: vi.fn() },
    employeeCtcMaster: { findUnique: vi.fn() },
}));
vi.mock('@/app/lib/db', () => ({ prisma: db }));

const mockCalc = vi.hoisted(() => ({
    getAttendanceDerivedPaidDays: vi.fn(),
    resolveComputedIncentive: vi.fn(),
    resolvePermissionDeduction: vi.fn(),
}));
vi.mock('./calculation', async (importOriginal) => {
    const actual = await importOriginal<typeof import('./calculation')>();
    return {
        ...actual,
        getAttendanceDerivedPaidDays: mockCalc.getAttendanceDerivedPaidDays,
        resolveComputedIncentive: mockCalc.resolveComputedIncentive,
        resolvePermissionDeduction: mockCalc.resolvePermissionDeduction,
    };
});

const mockSalaryRecovery = vi.hoisted(() => ({ getSalaryRecoveryDue: vi.fn() }));
vi.mock('@/app/lib/staff-loans/salary-recovery', () => ({ getSalaryRecoveryDue: mockSalaryRecovery.getSalaryRecoveryDue }));

const mockAdvanceRecovery = vi.hoisted(() => ({ getAdvanceRecoveryDue: vi.fn() }));
vi.mock('@/app/lib/staff-advances/salary-recovery', () => ({ getAdvanceRecoveryDue: mockAdvanceRecovery.getAdvanceRecoveryDue }));

import { computeEmployeePayroll, type PayrollSharedContext } from './run-payroll';

const components = [
    { id: 'basic', salaryId: 1, name: 'Basic', type: 'EARNINGS' as const, isActive: true, defaultPercent: null, percentBasis: null },
    { id: 'hra', salaryId: 2, name: 'HRA', type: 'EARNINGS' as const, isActive: true, defaultPercent: null, percentBasis: null },
    { id: 'incentive', salaryId: 3, name: 'Monthly Incentive', type: 'EARNINGS' as const, isActive: true, defaultPercent: null, percentBasis: null },
    { id: 'pf', salaryId: 5, name: 'PF', type: 'DEDUCTIONS' as const, isActive: true, defaultPercent: 12, percentBasis: 'BASIC' as const },
    { id: 'esi', salaryId: 6, name: 'ESI', type: 'DEDUCTIONS' as const, isActive: true, defaultPercent: 0.75, percentBasis: 'GROSS' as const },
    { id: 'other', salaryId: 7, name: 'Other Deductions', type: 'DEDUCTIONS' as const, isActive: true, defaultPercent: null, percentBasis: null },
    { id: 'staffloan', salaryId: 8, name: 'Staff Loan', type: 'DEDUCTIONS' as const, isActive: true, defaultPercent: null, percentBasis: null },
    { id: 'staffadvance', salaryId: 9, name: 'Staff Advance', type: 'DEDUCTIONS' as const, isActive: true, defaultPercent: null, percentBasis: null },
];

beforeEach(() => {
    vi.resetAllMocks();
    db.salaryComponent.findMany.mockResolvedValue(components);
    db.employeeSalaryMaster.findMany.mockResolvedValue([]);
    db.employeeCtcMaster.findUnique.mockResolvedValue({ monthlyCtc: 30000 });
    mockCalc.getAttendanceDerivedPaidDays.mockResolvedValue({ totalPaidDays: 30, lopDays: 0, workingDays: 30 });
    mockCalc.resolveComputedIncentive.mockResolvedValue(null);
    mockCalc.resolvePermissionDeduction.mockResolvedValue(0);
    mockSalaryRecovery.getSalaryRecoveryDue.mockResolvedValue({ totalAmount: 0, breakdown: [] });
    mockAdvanceRecovery.getAdvanceRecoveryDue.mockResolvedValue({ totalAmount: 0, breakdown: [] });
    db.user.findUnique.mockResolvedValue({ id: 'emp1', role: 'FDO', designation: { basicPercent: 70, hraPercent: 30 } });
});

describe('computeEmployeePayroll', () => {
    it('reports employeeFound: false for a missing employee, with no further computation', async () => {
        db.user.findUnique.mockResolvedValue(null);
        const result = await computeEmployeePayroll('missing', 9, 2026);
        expect(result.employeeFound).toBe(false);
        expect(result.components).toEqual([]);
    });

    it('computes Basic/HRA as read-only system values from CTC + designation split', async () => {
        const result = await computeEmployeePayroll('emp1', 9, 2026);
        const basic = result.components.find((c) => c.id === 'basic')!;
        const hra = result.components.find((c) => c.id === 'hra')!;
        expect(basic.amount).toBe(21000); // 30000 * 70%
        expect(hra.amount).toBe(9000);
        expect(basic.readOnly).toBe(true);
        expect(hra.readOnly).toBe(true);
    });

    it('computes PF as 12% of Actual Basic and ESI as 0.75% of Actual Gross, both read-only', async () => {
        const result = await computeEmployeePayroll('emp1', 9, 2026);
        const pf = result.components.find((c) => c.id === 'pf')!;
        const esi = result.components.find((c) => c.id === 'esi')!;
        expect(pf.amount).toBe(2520); // 21000 * 12%
        expect(esi.amount).toBe(225); // 30000 * 0.75%
        expect(pf.readOnly).toBe(true);
        expect(esi.readOnly).toBe(true);
    });

    it('an employee-level percentOverride on PF wins over the component default', async () => {
        db.employeeSalaryMaster.findMany.mockResolvedValue([{ salaryComponentId: 'pf', amount: 0, percentOverride: 0 }]);
        const result = await computeEmployeePayroll('emp1', 9, 2026);
        const pf = result.components.find((c) => c.id === 'pf')!;
        expect(pf.amount).toBe(0);
    });

    it('pulls the Staff Loan amount from getSalaryRecoveryDue, read-only, with breakdown attached', async () => {
        mockSalaryRecovery.getSalaryRecoveryDue.mockResolvedValue({
            totalAmount: 5000,
            breakdown: [{ loanId: 'l1', loanNumber: 'SL-1', scheduleId: 's1', installmentNo: 1, principal: 4500, interest: 500, amount: 5000, dueDate: '2026-09-01' }],
        });
        const result = await computeEmployeePayroll('emp1', 9, 2026);
        const staffLoan = result.components.find((c) => c.id === 'staffloan')!;
        expect(staffLoan.amount).toBe(5000);
        expect(staffLoan.readOnly).toBe(true);
        expect(staffLoan.staffLoanBreakdown).toHaveLength(1);
    });

    it('makes Staff Advance a read-only system amount only while a Staff Advance installment is due', async () => {
        mockAdvanceRecovery.getAdvanceRecoveryDue.mockResolvedValue({
            totalAmount: 10000,
            breakdown: [{ advanceId: 'a1', advanceNumber: 'SA-000001', scheduleId: 's1', installmentNo: 1, amount: 10000, dueDate: '2026-09-25' }],
        });
        // even a manual master default must not win over the recovery amount
        db.employeeSalaryMaster.findMany.mockResolvedValue([{ salaryComponentId: 'staffadvance', amount: 500, percentOverride: null }]);
        const result = await computeEmployeePayroll('emp1', 9, 2026);
        const advance = result.components.find((c) => c.id === 'staffadvance')!;
        expect(advance.amount).toBe(10000);
        expect(advance.readOnly).toBe(true);
        expect(advance.autoComputed).toBe(true);
        expect(advance.staffAdvanceBreakdown).toEqual([{ advanceId: 'a1', advanceNumber: 'SA-000001', scheduleId: 's1', installmentNo: 1, amount: 10000, dueDate: '2026-09-25' }]);
        expect(result.staffAdvanceDue?.totalAmount).toBe(10000);
    });

    it('leaves Staff Advance exactly as before (free entry from the master) when no advance installment is due', async () => {
        db.employeeSalaryMaster.findMany.mockResolvedValue([{ salaryComponentId: 'staffadvance', amount: 500, percentOverride: null }]);
        const result = await computeEmployeePayroll('emp1', 9, 2026);
        const advance = result.components.find((c) => c.id === 'staffadvance')!;
        expect(advance.amount).toBe(500);
        expect(advance.readOnly).toBe(false);
        expect(advance.staffAdvanceBreakdown).toBeUndefined();
        const withExisting = await computeEmployeePayroll('emp1', 9, 2026, new Map([['staffadvance', 1200]]));
        expect(withExisting.components.find((c) => c.id === 'staffadvance')!.amount).toBe(1200);
    });

    it('falls back to the flat master amount for a non-percentage deduction (e.g. Other Deductions)', async () => {
        db.employeeSalaryMaster.findMany.mockResolvedValue([{ salaryComponentId: 'other', amount: 750, percentOverride: null }]);
        const result = await computeEmployeePayroll('emp1', 9, 2026);
        const other = result.components.find((c) => c.id === 'other')!;
        expect(other.amount).toBe(750);
        expect(other.readOnly).toBe(false);
    });

    it('auto-fills the computed FDO incentive when no existing amount is provided', async () => {
        mockCalc.resolveComputedIncentive.mockResolvedValue(1200);
        const result = await computeEmployeePayroll('emp1', 9, 2026);
        const incentive = result.components.find((c) => c.id === 'incentive')!;
        expect(incentive.amount).toBe(1200);
        expect(incentive.autoComputed).toBe(true);
    });

    it('a provided existingLineItemAmounts value wins over the incentive auto-fill', async () => {
        mockCalc.resolveComputedIncentive.mockResolvedValue(1200);
        const result = await computeEmployeePayroll('emp1', 9, 2026, new Map([['incentive', 900]]));
        const incentive = result.components.find((c) => c.id === 'incentive')!;
        expect(incentive.amount).toBe(900);
        expect(incentive.autoComputed).toBe(false);
    });
});

describe('computeEmployeePayroll with a shared bulk-run context', () => {
    const shared = (over: Partial<PayrollSharedContext> = {}): PayrollSharedContext => ({
        salaryComponents: components as never,
        incentives: new Map([['emp1', 2500]]),
        incentiveBranchIds: new Set(['branchA']),
        ...over,
    });

    beforeEach(() => {
        db.user.findUnique.mockResolvedValue({ id: 'emp1', role: 'FDO', branchId: 'branchA', designation: { basicPercent: 70, hraPercent: 30 } });
    });

    it('uses the shared salary components instead of reading them again per employee', async () => {
        await computeEmployeePayroll('emp1', 9, 2026, undefined, shared());
        expect(db.salaryComponent.findMany).not.toHaveBeenCalled();
    });

    it("takes an FDO's incentive from the branch-wide run and does not run the per-employee lookup", async () => {
        const result = await computeEmployeePayroll('emp1', 9, 2026, undefined, shared());
        const incentive = result.components.find((c) => c.id === 'incentive')!;
        expect(incentive.amount).toBe(2500);
        expect(incentive.autoComputed).toBe(true);
        expect(mockCalc.resolveComputedIncentive).not.toHaveBeenCalled();
    });

    it('an FDO missing from a successful branch run has no incentive yet (0), like the single lookup', async () => {
        const result = await computeEmployeePayroll('emp1', 9, 2026, undefined, shared({ incentives: new Map() }));
        expect(result.components.find((c) => c.id === 'incentive')!.amount).toBe(0);
        expect(mockCalc.resolveComputedIncentive).not.toHaveBeenCalled();
    });

    it("falls back to the per-employee lookup when the FDO's branch run failed", async () => {
        mockCalc.resolveComputedIncentive.mockResolvedValue(1200);
        const result = await computeEmployeePayroll('emp1', 9, 2026, undefined, shared({ incentiveBranchIds: new Set(['otherBranch']) }));
        expect(mockCalc.resolveComputedIncentive).toHaveBeenCalledTimes(1);
        expect(result.components.find((c) => c.id === 'incentive')!.amount).toBe(1200);
    });

    it('a non-FDO gets no computed incentive (manual master amount), without any lookup', async () => {
        db.user.findUnique.mockResolvedValue({ id: 'emp1', role: 'BRANCH_MANAGER', branchId: 'branchA', designation: { basicPercent: 70, hraPercent: 30 } });
        const result = await computeEmployeePayroll('emp1', 9, 2026, undefined, shared());
        expect(result.components.find((c) => c.id === 'incentive')!.autoComputed).toBe(false);
        expect(mockCalc.resolveComputedIncentive).not.toHaveBeenCalled();
    });

    it('gives the same numbers with and without the shared context', async () => {
        mockCalc.resolveComputedIncentive.mockResolvedValue(2500);
        const without = await computeEmployeePayroll('emp1', 9, 2026);
        const withShared = await computeEmployeePayroll('emp1', 9, 2026, undefined, shared());
        expect(withShared).toEqual(without);
    });
});

