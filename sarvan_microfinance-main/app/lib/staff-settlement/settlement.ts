import { z } from 'zod';
import { SETTLEMENT_PAYMENT_MODES } from '@/app/lib/staff-loans/application';

/** Combined Early Settlement page for Staff Loans and Staff Advances. */
export const STAFF_SETTLEMENT_PAGE = '/dashboard/hr/staff-settlement';
/**
 * The retired Staff Loan "Repayments & Settlement" page. Roles that were granted it keep the matching access to
 * settle Staff Loans, so nobody loses the ability on deploy; new grants are made on STAFF_SETTLEMENT_PAGE.
 */
export const LEGACY_LOAN_REPAYMENTS_PAGE = '/dashboard/hr/staff-loans/repayments';

export type SettlementKind = 'LOAN' | 'ADVANCE';

const common = {
    id: z.string().min(1, 'Select what to settle'),
    paymentMode: z.enum(SETTLEMENT_PAYMENT_MODES),
    reference: z.string().trim().max(100).optional().nullable(),
    remarks: z.string().max(500).optional().nullable(),
    expectedVersion: z.number().int().positive('Expected version required'),
    /** The amount shown to the user; the server recomputes the real one and refuses on a mismatch. */
    expectedAmount: z.number().finite().nonnegative('Settlement amount is required'),
};
/**
 * The settlement amount and date are never accepted from the caller: the server derives the amount from the
 * schedule/allocation ledger and settles as of today (IST). `expectedAmount` only confirms what was quoted.
 */
export const staffSettlementSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('LOAN'), ...common }).strict(),
    z.object({ type: z.literal('ADVANCE'), ...common }).strict(),
]).superRefine((data, ctx) => {
    if (data.paymentMode === 'BANK_TRANSFER' && !data.reference) {
        ctx.addIssue({ code: 'custom', path: ['reference'], message: 'Enter the payment reference / UTR number for a bank transfer' });
    }
});
export type StaffSettlementInput = z.infer<typeof staffSettlementSchema>;

export type SettlementListFilters = {
    search?: string;
    branchId?: string;
    /** Base role of the employee (User.role). */
    role?: string;
    departmentId?: string;
};

export type SettlementListItem = {
    id: string;
    number: string;
    employeeName: string;
    employeeCode: string | null;
    department: string | null;
    branchName: string;
    totalOutstanding: number;
};

export type SettlementScheduleRow = {
    installmentNo: number;
    /** e.g. "Sep 2026"; the actual due date stays in the database. */
    month: string;
    principal: number;
    /** Always 0 for a Staff Advance. */
    interest: number;
    totalDue: number;
    paid: number;
    outstanding: number;
    status: 'PAID' | 'PARTIAL' | 'PENDING' | 'OVERDUE';
};

/** Salary picture from the existing payroll calculation, and what it becomes once this obligation is settled. */
export type SettlementSalary = {
    month: number;
    year: number;
    currentSalary: number;
    otherDeductions: number;
    existingLoanDeduction: number;
    existingAdvanceDeduction: number;
    totalDeductions: number;
    currentInHand: number;
    /** What payroll would deduct this month for the loan/advance being settled (removed once it is settled). */
    thisObligationDeduction: number;
    expectedInHand: number;
};

export type SettlementDetail = {
    type: SettlementKind;
    id: string;
    number: string;
    version: number;
    employee: { id: string; name: string; code: string | null; department: string | null; designation: string; branch: string };
    branchName: string;
    originalAmount: number;
    totalRepayable: number;
    principalOutstanding: number;
    /** Always 0 for a Staff Advance. */
    interestOutstanding: number;
    totalOutstanding: number;
    paidAmount: number;
    totalInstallments: number;
    remainingInstallments: number;
    settlement: {
        /** What the employee must pay now. */
        amount: number;
        principal: number;
        /** Interest on installments already due. Always 0 for a Staff Advance. */
        interest: number;
        /** Interest on installments not yet due, waived by an early settlement. Always 0 for a Staff Advance. */
        waivedInterest: number;
        settlementDate: string;
    };
    schedule: SettlementScheduleRow[];
    salary: SettlementSalary | null;
    /** Set when a payroll deduction is submitted but not marked paid yet: settlement is blocked until it is. */
    blockedReason: string | null;
    canSettle: boolean;
};

export type SettlementCapabilities = { loan: { view: boolean; settle: boolean }; advance: { view: boolean; settle: boolean } };
