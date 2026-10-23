import { z } from 'zod';
import { previewInstallments } from '@/app/lib/staff-loans/application';
import type { EmployeeOption, EmployeeProfileDetail } from '@/app/lib/staff-loans/application';

/**
 * Staff Advance: an interest-free salary advance repaid in one or two monthly salary deductions, chosen on the
 * application. Client-safe (no server imports) so forms and the server share one definition of the rules.
 */
/** The repayment periods an application may choose from. */
export const ADVANCE_REPAYMENT_OPTIONS = [1, 2] as const;
/** The period pre-selected on the form and used when an API caller does not send one (every advance so far). */
export const ADVANCE_REPAYMENT_MONTHS = 2;

export const ADVANCE_APPLY_PAGE = '/dashboard/hr/staff-advance/apply';
export const ADVANCE_APPROVAL_PAGE = '/dashboard/hr/staff-advance/approval';
export const ADVANCE_MANAGEMENT_PAGE = '/dashboard/hr/staff-advance/management';

/** Short business-facing number, e.g. SA-000001. The internal key stays the cuid `id`. */
export function formatStaffAdvanceNumber(sequence: number | bigint): string {
    return `SA-${String(sequence).padStart(6, '0')}`;
}

/**
 * The installment amounts (one per repayment month). Interest-free, so total repayable equals the advance and
 * every paisa is distributed (an odd paisa goes to the first installment) - same calculation the Staff Loan
 * schedule uses. A one-month advance is a single installment of the full amount.
 */
export function splitAdvanceInstallments(amount: number, months: number = ADVANCE_REPAYMENT_MONTHS): number[] {
    return previewInstallments(amount, months, 'INTEREST_FREE', 0).installments.map(i => i.total);
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** In-hand salary once this advance's first installment is deducted (may go negative: callers must check). */
export function projectInHand(currentInHand: number, monthlyRepayment: number): SalaryProjection {
    return { monthlyRepayment, currentInHand, projectedInHand: round2(currentInHand - monthlyRepayment) };
}

// ── validation ────────────────────────────────────────────────────────────

const amountSchema = z.number({ required_error: 'Enter the advance amount', invalid_type_error: 'Enter the advance amount' })
    .finite('Enter the advance amount')
    .min(1, 'The advance amount must be at least ₹1')
    .max(9999999999999.99)
    .refine(n => /^\d+(\.\d{1,2})?$/.test(String(n)), 'Use at most two decimal places');

// Already uploaded via POST /api/hr/staff-advances/documents/upload; same shape and rules as the Staff Loan one.
const documentRefSchema = z.object({
    fileKey: z.string().min(1, 'Upload the supporting document'),
    fileName: z.string().trim().min(1).max(255),
}).strict();

export const advanceApplicationSchema = z.object({
    employeeId: z.string().min(1).optional(),
    amount: amountSchema,
    // One or two months only, so a tampered request cannot ask for a longer period. Omitted means the default.
    repaymentMonths: z.number({ invalid_type_error: 'Choose a repayment period of 1 or 2 months' })
        .refine(months => (ADVANCE_REPAYMENT_OPTIONS as readonly number[]).includes(months), 'Choose a repayment period of 1 or 2 months').optional(),
    purpose: z.string().trim().min(1, 'Enter the reason for the advance'),
    remarks: z.string().trim(),
    // Required for every new application, like a staff loan.
    document: documentRefSchema,
}).strict();
export type AdvanceApplicationInput = z.infer<typeof advanceApplicationSchema>;

export const advanceReviewSchema = z.object({
    id: z.string().min(1),
    expectedVersion: z.number().int().positive(),
    action: z.enum(['APPROVE', 'REJECT']),
    remarks: z.string().trim(),
}).strict().refine(v => v.action === 'APPROVE' || v.remarks.length > 0, { path: ['remarks'], message: 'Enter a reason for rejecting the application' });

// Approver edit while the advance is under review. `reason` is the approver's audit note; `remarks` is the
// advance's own remarks field. The repayment period is not editable.
export const advanceEditSchema = z.object({
    expectedVersion: z.number().int().positive(),
    amount: amountSchema,
    purpose: z.string().trim().min(1, 'Enter the reason for the advance'),
    remarks: z.string().trim(),
    reason: z.string().trim(),
    // Only sent when the approver replaced the file.
    document: documentRefSchema.optional(),
}).strict();
export type AdvanceEditInput = z.infer<typeof advanceEditSchema>;

export const advanceCancelSchema = z.object({ id: z.string().min(1), expectedVersion: z.number().int().positive() }).strict();

// Same fields and rules as a staff loan disbursement. The two installments are created here. With the salary date
// (set on the Staff Loan approval workflow) the server derives both due dates from it and `firstDueMonth`;
// `firstDueDate` is only used when no salary date has been set yet.
export const advanceDisburseSchema = z.object({
    id: z.string().min(1),
    expectedVersion: z.number().int().positive(),
    disbursementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD format'),
    paymentMode: z.enum(['CASH', 'BANK_TRANSFER']),
    reference: z.string().trim().nullable(),
    firstDueMonth: z.enum(['THIS_MONTH', 'NEXT_MONTH']).optional(),
    firstDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD format').optional(),
    remarks: z.string().trim().nullable(),
}).strict().superRefine((data, ctx) => {
    // A bank transfer must be traceable: the UTR / transaction reference is mandatory.
    if (data.paymentMode === 'BANK_TRANSFER' && !data.reference) {
        ctx.addIssue({ code: 'custom', path: ['reference'], message: 'Enter the payment reference / UTR number for a bank transfer' });
    }
});
export type AdvanceDisburseInput = z.infer<typeof advanceDisburseSchema>;

// ── shared shapes ─────────────────────────────────────────────────────────

export type AdvanceStatus = 'SUBMITTED' | 'APPROVED' | 'ACTIVE' | 'COMPLETED' | 'REJECTED' | 'CANCELLED';

/** Salary picture from the existing payroll calculation for one month. */
export type AdvanceSalarySummary = {
    month: number;
    year: number;
    monthlyCtc: number;
    basicSalary: number;
    grossSalary: number;
    earnings: { name: string; amount: number }[];
    deductionLines: { name: string; amount: number; kind: 'LOAN' | 'ADVANCE' | 'OTHER' }[];
    totalDeductions: number;
    existingLoanDeduction: number;
    existingAdvanceDeduction: number;
    otherDeductions: number;
    currentInHand: number;
};

export type SalaryProjection = { monthlyRepayment: number; currentInHand: number; projectedInHand: number };

export type ObligationRow = {
    id: string;
    number: string;
    type: 'STAFF_LOAN' | 'STAFF_ADVANCE';
    applicationDate: string;
    approvedAmount: number;
    outstandingAmount: number | null;
    monthlyDeduction: number;
    repaymentMonths: number;
    paidInstallments: number;
    remainingInstallments: number;
    status: string;
    completionDate: string | null;
    /** This loan's / advance's own repayment track; null until it has been disbursed. */
    schedule: AdvanceScheduleRow[] | null;
};

export type AdvanceScheduleRow = {
    id: string;
    installmentNo: number;
    dueDate: string;
    principal: number;
    /** Always 0: a Staff Advance carries no interest. */
    interest: number;
    totalDue: number;
    paidAmount: number;
    paymentDate: string | null;
    outstanding: number;
    status: 'PAID' | 'PARTIAL' | 'PENDING' | 'OVERDUE';
};

export type AdvanceRow = {
    id: string;
    advanceNumber: string;
    employeeId: string;
    employeeCode: string | null;
    employeeName: string;
    department: string | null;
    designation: string;
    branchName: string;
    status: AdvanceStatus;
    amount: number;
    totalRepayable: number;
    paidAmount: number;
    /** Null until the advance is approved (nothing is owed before that). */
    outstandingAmount: number | null;
    monthlyRepayment: number;
    repaymentMonths: number;
    paidInstallments: number;
    remainingInstallments: number;
    purpose: string;
    remarks: string;
    /** Supporting document; null for an advance applied before the document became mandatory. */
    document: { fileName: string; mimeType: string; fileSize: number } | null;
    /** Salary picture captured when the advance was applied for / last edited. */
    currentInHand: number | null;
    projectedInHand: number | null;
    currentStage: string | null;
    canReview: boolean;
    /** Approved and waiting for this actor (a disbursement-authority holder) to pay it out. */
    canDisburse: boolean;
    version: number;
    createdAt: string;
    approvedAt: string | null;
    disbursedAt: string | null;
    completedAt: string | null;
};

/** register = Advance Management page, approvals = Approval queue, disbursements = Disbursement tab. */
export type AdvanceCapabilities = { register: boolean; approvals: boolean; disbursements: boolean };

export type AdvanceSummaryCards = {
    totalAdvances: number;
    activeAdvances: number;
    completedAdvances: number;
    totalAdvanceAmount: number;
    totalOutstanding: number;
    repaidThisMonth: number;
};

export type AdvanceList = {
    items: AdvanceRow[];
    page: number;
    pageSize: number;
    total: number;
    capabilities: AdvanceCapabilities;
    /** Only on the register tab. */
    summary: AdvanceSummaryCards | null;
    /** Salary day of the month from the Staff Loan workflow master; only filled for the disbursements tab. */
    salaryDay: number | null;
};

export type AdvanceOptions = {
    employee: EmployeeProfileDetail;
    employees?: EmployeeOption[];
    canSelectEmployee: boolean;
    salary: AdvanceSalarySummary;
    obligations: ObligationRow[];
    /** The employee's advance that is still under review or being repaid, if any (blocks a new one). */
    openAdvance: { advanceNumber: string; status: AdvanceStatus } | null;
    workflowAvailable: boolean;
    repaymentMonths: number;
};

export type AdvanceDetail = AdvanceRow & {
    employee: EmployeeProfileDetail;
    salary: AdvanceSalarySummary;
    /** Current in-hand minus the monthly repayment (under review); the application-time figure afterwards. */
    projection: SalaryProjection;
    obligations: ObligationRow[];
    stages: { levelOrder: number; stageName: string; roleName: string }[];
    decisions: {
        id: string; action: string; stageName: string | null; remarks: string | null; actorName: string; createdAt: string;
        changes: Record<string, { from: unknown; to: unknown }> | null;
    }[];
    /** How the advance was paid out (null until disbursed). */
    payment: { mode: string; reference: string | null } | null;
    /** Real installments once disbursed. */
    schedule: AdvanceScheduleRow[] | null;
    /** Expected installments while still under review or awaiting disbursement. */
    schedulePreview: { installmentNo: number; dueDate: string; amount: number }[] | null;
};
