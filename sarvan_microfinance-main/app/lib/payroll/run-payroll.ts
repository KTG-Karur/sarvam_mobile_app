import { prisma } from '@/app/lib/db';
import {
    computeCtcBreakdown,
    getAttendanceDerivedPaidDays,
    resolveComputedIncentive,
    resolveComputedIncentivesByBranch,
    resolvePermissionDeduction,
    resolvePercentDeduction,
} from './calculation';
import { getSalaryRecoveryDue, type SalaryRecoveryLoanDue } from '@/app/lib/staff-loans/salary-recovery';
import { getAdvanceRecoveryDue, type SalaryRecoveryAdvanceDue } from '@/app/lib/staff-advances/salary-recovery';
import type { GridRowBase } from './payroll-grid';
import type { UnpaidDaysBreakdown } from './attendance-days';

export type ComputedPayrollComponent = {
    id: string;
    salaryId: number;
    name: string;
    type: 'EARNINGS' | 'DEDUCTIONS';
    amount: number;
    /** Basic/HRA/Staff Loan/percent-based PF-ESI — never a stored or
     * client-editable override, always freshly computed. */
    readOnly: boolean;
    autoComputed: boolean;
    /** How the amount is derived — the bulk payroll grid recomputes BASIC/HRA
     * from Actual Gross and PERCENT (PF/ESI) from its rule live as Days/LOP/CTC
     * are edited; FREE is an entered/system-suggested flat amount. */
    kind: 'BASIC' | 'HRA' | 'PERCENT' | 'FREE';
    /** Effective rule (employee override already applied) for kind PERCENT. */
    percentRule?: { percent: number; basis: 'BASIC' | 'GROSS'; maxAmount: number | null; ctcEligibilityLimit: number | null };
    /** Amount is backed by another module's schedule (Staff Loan / Staff Advance
     * installment) — editing it in the grid does not change what that schedule posts. */
    systemBacked?: boolean;
    staffLoanBreakdown?: { loanNumber: string; installmentNo: number; amount: number; dueDate: string }[];
    staffAdvanceBreakdown?: { advanceNumber: string; installmentNo: number; amount: number; dueDate: string }[];
};

export type EmployeePayrollComputation = {
    employeeFound: boolean;
    ctcInfo: {
        totalPaidDays: number; lopDays: number; workingDays: number;
        actualBasic: number; actualHra: number; actualGross: number; monthlyCtc: number;
        basicPercent: number; hraPercent: number;
        /** Where the LOP figure came from — absent / half-day / LOP-leave / not-employed days. */
        lopBreakdown?: UnpaidDaysBreakdown;
    } | null;
    staffLoanDue: { totalAmount: number; breakdown: SalaryRecoveryLoanDue[] } | null;
    staffAdvanceDue: { totalAmount: number; breakdown: SalaryRecoveryAdvanceDue[] } | null;
    permissionHoursThisMonth: number;
    components: ComputedPayrollComponent[];
};

/**
 * Computes every active SalaryComponent's amount for one employee/period —
 * the single source of truth for what a payroll run for this employee
 * should look like. Used by:
 *  - the individual Payroll page's preview (GET /api/payroll/salary-pay)
 *  - Bulk Payroll Run (no per-employee review step at all — every
 *    component for every employee in scope goes straight through this)
 * POST's own submit path recomputes Basic/HRA/Staff Loan/percent-based
 * deductions the same way inline (it also needs to weigh in whatever the
 * admin edited for the free-entry components), so isn't routed through
 * here — but must stay in sync with this function's system-computed rules
 * if either changes.
 *
 * `existingLineItemAmounts`, when provided, lets free-entry components
 * (Other Deductions, Arrear, Staff Advance, ...) show a previously saved
 * value instead of the raw master default — used by the individual
 * preview only; Bulk Run always starts fresh (omit it there).
 */
/**
 * Data that is identical for every employee of one payroll month. A bulk run builds this ONCE and passes it to
 * every computeEmployeePayroll call instead of re-reading it per employee.
 */
export type PayrollSharedContext = {
    /** Active salary components (same for everyone). */
    salaryComponents: Awaited<ReturnType<typeof prisma.salaryComponent.findMany>>;
    /** FDO id -> computed incentive for the month, from one engine run per branch. */
    incentives: Map<string, number>;
    /** Branches whose run succeeded; an FDO of any other branch falls back to the per-employee lookup. */
    incentiveBranchIds: Set<string>;
};

/** `branchIds`: the branches of the employees being processed (only their FDOs' incentives are computed). */
export async function buildPayrollSharedContext(month: number, year: number, branchIds: readonly string[]): Promise<PayrollSharedContext> {
    const [salaryComponents, byBranch] = await Promise.all([
        prisma.salaryComponent.findMany({ where: { isActive: true }, orderBy: { salaryId: 'asc' } }),
        resolveComputedIncentivesByBranch(month, year, branchIds),
    ]);
    return { salaryComponents, incentives: byBranch.incentives, incentiveBranchIds: byBranch.coveredBranchIds };
}

export async function computeEmployeePayroll(
    employeeId: string,
    month: number,
    year: number,
    existingLineItemAmounts?: Map<string, number>,
    shared?: PayrollSharedContext,
): Promise<EmployeePayrollComputation> {
    const employee = await prisma.user.findUnique({
        where: { id: employeeId },
        select: { id: true, role: true, branchId: true, designation: { select: { basicPercent: true, hraPercent: true } } },
    });
    if (!employee) {
        return { employeeFound: false, ctcInfo: null, staffLoanDue: null, staffAdvanceDue: null, permissionHoursThisMonth: 0, components: [] };
    }

    const [salaryComponents, masterAmounts, ctcMaster, days, loanDue, advanceDue] = await Promise.all([
        shared ? Promise.resolve(shared.salaryComponents) : prisma.salaryComponent.findMany({ where: { isActive: true }, orderBy: { salaryId: 'asc' } }),
        prisma.employeeSalaryMaster.findMany({ where: { employeeId, isActive: true } }),
        prisma.employeeCtcMaster.findUnique({ where: { employeeId } }),
        getAttendanceDerivedPaidDays(employeeId, month, year),
        getSalaryRecoveryDue(employeeId, month, year),
        getAdvanceRecoveryDue(employeeId, month, year),
    ]);

    const monthlyCtc = ctcMaster ? Number(ctcMaster.monthlyCtc) : 0;
    const basicPercent = Number(employee.designation?.basicPercent ?? 70);
    const hraPercent = Number(employee.designation?.hraPercent ?? 30);
    const breakdown = computeCtcBreakdown({ monthlyCtc, basicPercent, hraPercent, workingDays: days.workingDays, totalPaidDays: days.totalPaidDays });
    const ctcInfo = { ...days, actualBasic: breakdown.actualBasic, actualHra: breakdown.actualHra, actualGross: breakdown.actualGross, monthlyCtc, basicPercent, hraPercent };

    const [computedIncentive, computedPermissionDeduction] = await Promise.all([
        // Only FDOs are scored; a missing FDO in the batch result simply has no incentive yet (0), exactly as the
        // single-employee lookup returns 0 for an FDO with no report row.
        shared && (employee.role !== 'FDO' || (employee.branchId && shared.incentiveBranchIds.has(employee.branchId)))
            ? Promise.resolve(employee.role === 'FDO' ? (shared.incentives.get(employeeId) ?? 0) : null)
            : resolveComputedIncentive(employeeId, employee.role, month, year),
        resolvePermissionDeduction(employeeId, month, year),
    ]);

    const components: ComputedPayrollComponent[] = salaryComponents.map((sc) => {
        const masterAmount = masterAmounts.find((m) => m.salaryComponentId === sc.id);
        const existingAmount = existingLineItemAmounts?.get(sc.id);
        const nameLower = sc.name.trim().toLowerCase();
        const isBasic = nameLower === 'basic';
        const isHra = nameLower === 'hra';
        const isStaffLoan = nameLower === 'staff loan';
        const isStaffAdvance = nameLower === 'staff advance';
        const isIncentiveComponent = /incentive/i.test(sc.name);
        const isPermissionDeductionComponent = /permission deduction/i.test(sc.name);
        const percentAmount = resolvePercentDeduction({
            defaultPercent: sc.defaultPercent !== null ? Number(sc.defaultPercent) : null,
            percentBasis: sc.percentBasis,
            percentOverride: masterAmount?.percentOverride !== null && masterAmount?.percentOverride !== undefined ? Number(masterAmount.percentOverride) : null,
            actualBasic: ctcInfo.actualBasic,
            actualGross: ctcInfo.actualGross,
            maxAmount: sc.maxAmount != null ? Number(sc.maxAmount) : null,
            monthlyCtc,
            ctcEligibilityLimit: sc.ctcEligibilityLimit != null ? Number(sc.ctcEligibilityLimit) : null,
        });

        // System-computed: Basic/HRA/Staff Loan always were; a percentage-
        // configured deduction (PF/ESI, or anything else an admin sets a
        // defaultPercent on) joins them — never a stored/manual amount once
        // it's percentage-based.
        if (isBasic) {
            return { id: sc.id, salaryId: sc.salaryId, name: sc.name, type: sc.type, amount: ctcInfo.actualBasic, readOnly: true, autoComputed: true, kind: 'BASIC' };
        }
        if (isHra) {
            return { id: sc.id, salaryId: sc.salaryId, name: sc.name, type: sc.type, amount: ctcInfo.actualHra, readOnly: true, autoComputed: true, kind: 'HRA' };
        }
        if (isStaffLoan) {
            return { id: sc.id, salaryId: sc.salaryId, name: sc.name, type: sc.type, amount: loanDue.totalAmount, readOnly: true, autoComputed: true, kind: 'FREE', systemBacked: true, staffLoanBreakdown: loanDue.breakdown };
        }
        // Staff Advance stays a free-entry deduction exactly as before, except for an employee who has a Staff
        // Advance module installment due this month: then it is the system-computed recovery (read-only).
        if (isStaffAdvance && advanceDue.totalAmount > 0) {
            return { id: sc.id, salaryId: sc.salaryId, name: sc.name, type: sc.type, amount: advanceDue.totalAmount, readOnly: true, autoComputed: true, kind: 'FREE', systemBacked: true, staffAdvanceBreakdown: advanceDue.breakdown };
        }
        if (percentAmount !== null) {
            return {
                id: sc.id, salaryId: sc.salaryId, name: sc.name, type: sc.type, amount: percentAmount, readOnly: true, autoComputed: true,
                kind: 'PERCENT',
                percentRule: {
                    percent: Number(masterAmount?.percentOverride ?? sc.defaultPercent),
                    basis: sc.percentBasis as 'BASIC' | 'GROSS',
                    maxAmount: sc.maxAmount != null ? Number(sc.maxAmount) : null,
                    ctcEligibilityLimit: sc.ctcEligibilityLimit != null ? Number(sc.ctcEligibilityLimit) : null,
                },
            };
        }

        let amount = 0;
        if (existingAmount !== undefined) {
            amount = existingAmount;
        } else if (isIncentiveComponent && computedIncentive !== null) {
            amount = computedIncentive;
        } else if (isPermissionDeductionComponent) {
            amount = computedPermissionDeduction;
        } else if (masterAmount) {
            amount = Number(masterAmount.amount);
        }

        return {
            id: sc.id, salaryId: sc.salaryId, name: sc.name, type: sc.type, amount,
            readOnly: false,
            kind: 'FREE',
            autoComputed:
                (existingAmount === undefined && isIncentiveComponent && computedIncentive !== null) ||
                (existingAmount === undefined && isPermissionDeductionComponent && computedPermissionDeduction > 0),
        };
    });

    return { employeeFound: true, ctcInfo, staffLoanDue: loanDue, staffAdvanceDue: advanceDue, permissionHoursThisMonth: 0, components };
}

/**
 * Bridges a computeEmployeePayroll result to the pure grid model
 * (payroll-grid.ts), so the Bulk Payroll grid and the bulk-run API both
 * derive every figure from the same baseline + the same formulas. Returns
 * null when there is no ctcInfo (employee not found).
 */
export function toGridRowBase(computation: EmployeePayrollComputation): GridRowBase | null {
    const info = computation.ctcInfo;
    if (!info) return null;
    return {
        totalPaidDays: info.totalPaidDays,
        lopDays: info.lopDays,
        monthlyCtc: info.monthlyCtc,
        basicPercent: info.basicPercent,
        hraPercent: info.hraPercent,
        components: computation.components.map((c) => ({
            id: c.id, salaryId: c.salaryId, name: c.name, type: c.type,
            kind: c.kind, amount: c.amount, percentRule: c.percentRule, systemBacked: c.systemBacked,
        })),
    };
}
