import { z } from 'zod';
import { Prisma } from '@prisma/client';

export const APPLY_PAGE = '/dashboard/hr/staff-loans/apply';
export const MANAGEMENT_PAGE = '/dashboard/hr/staff-loans/management';
export const applicationSchema = z.object({
    employeeId: z.string().min(1).optional(),
    schemeId: z.string().min(1, 'Select a scheme'),
    requestedAmount: z.number().finite().positive('Enter a positive amount').max(9999999999999.99)
        .refine(n => /^\d+(\.\d{1,2})?$/.test(String(n)), 'Use at most two decimal places'),
    tenureMonths: z.number().int().positive('Enter a positive tenure'),
    recoveryMethod: z.enum(['SALARY', 'CASH_BANK']),
    purpose: z.string().trim().min(1, 'Enter the loan purpose'),
    remarks: z.string().trim(),
    // Already uploaded via POST /api/hr/staff-loans/documents/upload; required for every save.
    document: z.object({
        fileKey: z.string().min(1, 'Upload the supporting document'),
        fileName: z.string().trim().min(1).max(255),
    }).strict(),
}).strict();
export type ApplicationInput = z.infer<typeof applicationSchema>;
export const saveApplicationSchema = z.object({
    application: applicationSchema,
    id: z.string().min(1).nullable(),
    expectedVersion: z.number().int().positive().nullable(),
    submit: z.boolean(),
}).strict().refine(v => (v.id === null) === (v.expectedVersion === null), 'An existing application requires its version');
export const reviewSchema = z.object({
    id: z.string().min(1), expectedVersion: z.number().int().positive(),
    action: z.enum(['APPROVE', 'REJECT']), remarks: z.string().trim(),
}).strict().refine(v => v.action === 'APPROVE' || v.remarks.length > 0, { path: ['remarks'], message: 'Enter a reason for rejecting the application' });

// Approver edit of every application detail while the loan is under review: scheme, interest type and
// rate, amount, tenure, recovery mode, purpose, applicant remarks and the supporting document.
// `reason` is the approver's note for the audit trail; `remarks` is the loan's own applicant-remarks field.
export const editTermsSchema = z.object({
    expectedVersion: z.number().int().positive(),
    schemeId: z.string().min(1, 'Select a scheme'),
    requestedAmount: z.number().finite().positive('Enter a positive amount').max(9999999999999.99)
        .refine(n => /^\d+(\.\d{1,2})?$/.test(String(n)), 'Use at most two decimal places'),
    tenureMonths: z.number().int().positive('Enter a positive tenure'),
    interestType: z.enum(['INTEREST_FREE', 'FLAT', 'MONTHLY']),
    annualInterestRate: z.number().finite().nonnegative().max(999.9999)
        .refine(n => /^\d+(\.\d{1,4})?$/.test(String(n)), 'Use at most four decimal places'),
    recoveryMethod: z.enum(['SALARY', 'CASH_BANK']),
    purpose: z.string().trim().min(1, 'Enter the loan purpose'),
    remarks: z.string().trim(),
    // Only sent when the approver replaced the file (uploaded via POST /hr/staff-loans/documents/upload).
    document: z.object({
        fileKey: z.string().min(1),
        fileName: z.string().trim().min(1).max(255),
    }).strict().optional(),
    reason: z.string().trim(),
}).strict().superRefine((data, ctx) => {
    if (data.interestType === 'INTEREST_FREE' && data.annualInterestRate !== 0) ctx.addIssue({ code: 'custom', path: ['annualInterestRate'], message: 'An interest-free loan cannot carry an interest rate.' });
    if (data.interestType !== 'INTEREST_FREE' && data.annualInterestRate <= 0) ctx.addIssue({ code: 'custom', path: ['annualInterestRate'], message: 'Enter a positive interest rate.' });
});
export type EditTermsInput = z.infer<typeof editTermsSchema>;

/** Short business-facing loan number, e.g. SL-000001. The internal key stays the cuid `id`. */
export function formatStaffLoanNumber(sequence: number | bigint): string {
    return `SL-${String(sequence).padStart(6, '0')}`;
}
export const cancelSchema = z.object({ id: z.string().min(1), expectedVersion: z.number().int().positive() }).strict();
export const disburseSchema = z.object({
    id: z.string().min(1),
    expectedVersion: z.number().int().positive(),
    disbursementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD format'),
    paymentMode: z.enum(['CASH', 'BANK_TRANSFER']),
    reference: z.string().trim().nullable(),
    // With a salary date configured (Masters > Staff Loan Approval Workflow) the server derives every due
    // date from it and `firstDueMonth`. `firstDueDate` is only used when no salary date has been set yet.
    firstDueMonth: z.enum(['THIS_MONTH', 'NEXT_MONTH']).optional(),
    firstDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD format').optional(),
    remarks: z.string().trim().nullable(),
}).strict().superRefine((data, ctx) => {
    // A bank transfer must be traceable: the UTR / transaction reference is mandatory.
    if (data.paymentMode === 'BANK_TRANSFER' && !data.reference) {
        ctx.addIssue({ code: 'custom', path: ['reference'], message: 'Enter the payment reference / UTR number for a bank transfer' });
    }
});
export type DisburseInput = z.infer<typeof disburseSchema>;

export type RoleAssignment = { roleId: string; branchId: string | null };
export function roleCanAct(assignments: RoleAssignment[], roleId: string, branchId: string) {
    return assignments.some(a => a.roleId === roleId && (a.branchId === null || a.branchId === branchId));
}

export function serviceMonths(joiningYmd: string, todayYmd: string) {
    const [jy, jm, jd] = joiningYmd.split('-').map(Number);
    const [ty, tm, td] = todayYmd.split('-').map(Number);
    if (joiningYmd > todayYmd) return -1;
    return (ty - jy) * 12 + tm - jm - (td < jd ? 1 : 0);
}

export type StaffLoanInterestType = 'INTEREST_FREE' | 'FLAT' | 'MONTHLY';

// Total interest for the full tenure: FLAT applies `rate` as an annual percentage
// (rate * months / 12), MONTHLY applies it as a flat percentage of principal charged
// every month (rate * months) — e.g. 30000 principal @ 1% MONTHLY over 10 months
// charges 300/month, 3000 total, vs FLAT @ 1% p.a. which would charge 25/month.
export function totalFlatInterest(principal: Prisma.Decimal, months: number, interestType: StaffLoanInterestType, rate: number) {
    if (interestType === 'INTEREST_FREE') return new Prisma.Decimal(0);
    const divisor = interestType === 'MONTHLY' ? 100 : 1200;
    return principal.mul(String(rate)).mul(months).div(divisor).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

// Monetary calculations stay decimal until serialized for display. Round the
// total once, then distribute remaining paise so every installment reconciles.
export function previewInstallments(amount: number, months: number, interestType: StaffLoanInterestType, annualRate: number) {
    if (!Number.isInteger(months) || months < 1 || !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(annualRate) || annualRate < 0) throw new Error('Invalid repayment terms');
    const principal = new Prisma.Decimal(String(amount));
    const interest = totalFlatInterest(principal, months, interestType, annualRate);
    const principalPaise = principal.mul(100).toDecimalPlaces(0);
    const interestPaise = interest.mul(100).toDecimalPlaces(0);
    const basePrincipal = principalPaise.div(months).floor();
    const baseInterest = interestPaise.div(months).floor();
    const extraPrincipal = principalPaise.mod(months).toNumber();
    const extraInterest = interestPaise.mod(months).toNumber();
    // Limit the preview payload, not the scheme's configurable tenure.
    const installments = Array.from({ length: Math.min(months, 120) }, (_, i) => {
        const p = basePrincipal.plus(i < extraPrincipal ? 1 : 0).div(100);
        const interestDue = baseInterest.plus(i < extraInterest ? 1 : 0).div(100);
        return { installmentNo: i + 1, principal: p.toNumber(), interest: interestDue.toNumber(), total: p.plus(interestDue).toNumber() };
    });
    return { principal: principal.toNumber(), totalInterest: interest.toNumber(), totalRepayment: principal.plus(interest).toNumber(), installmentCount: months, installments };
}

export type ApplicationOption = {
    id: string; name: string; code: string; maximumAmount: number | null; maximumTenureMonths: number;
    minimumServiceMonths: number; minimumSalaryPerMonth: number; maximumActiveLoans: number;
    interestType: StaffLoanInterestType; annualInterestRate: number;
    recoveryMethods: ('SALARY' | 'CASH_BANK')[]; eligibilityError: string | null;
};

export type EmployeeProfileSummary = {
    id: string;
    name: string;
    employeeId: string | null;
    branchName: string | null;
    branchId: string | null;
    departmentName: string | null;
    dateOfJoining: string | null;
    serviceMonths: number;
    serviceFormatted: string;
    designation: string;
    grossSalary: number;
    activeLoansCount: number;
};

export type EmployeeProfileDetail = {
    id: string;
    name: string;
    employeeId: string | null;
    dateOfJoining: string | null;
    experience: string;
    department: string | null;
    designation: string;
    branch: string | null;
    employmentStatus: 'Active' | 'Inactive' | 'Exited';
    confirmationDate: string | null;
    grossSalary: number;
    monthlyCtc: number | null;
    salaryComponents: { name: string; type: string; amount: number }[];
};

export type EmployeeOption = {
    id: string;
    name: string;
    employeeId: string | null;
    branchName: string | null;
    role: string;
};

export type ApplicationOptions = {
    employee: EmployeeProfileSummary;
    employees?: EmployeeOption[];
    canSelectEmployee: boolean;
    schemes: ApplicationOption[];
    workflowAvailable: boolean;
};
export type ApplicationRow = {
    id: string; loanNumber: string; employeeId: string; employeeName: string; employeeCode: string | null;
    branchName: string; schemeName: string; status: string; requestedAmount: number; approvedAmount: number | null;
    tenureMonths: number; interestType: StaffLoanInterestType; annualInterestRate: number;
    recoveryMethod: 'SALARY' | 'CASH_BANK'; purpose: string; remarks: string; schemeId: string; version: number;
    document: { fileKey: string; fileName: string; mimeType: string; fileSize: number } | null;
    /** Calculated with the same logic as the repayment schedule (see totalFlatInterest/previewInstallments). */
    interestAmount: number; totalPayable: number; monthlyInstallment: number;
    /** Employee's loan counts (excluding drafts, cancelled and rejected); only filled on list responses. */
    totalLoans?: number; completedLoans?: number;
    currentStage: string | null; canReview: boolean; createdAt: string;
};

export type PastLoanRow = {
    id: string; loanNumber: string; loanDate: string; loanAmount: number; interestAmount: number; totalPayable: number;
    tenureMonths: number; paidAmount: number | null; outstandingAmount: number | null; status: string; closedAt: string | null;
    /** This loan's own repayment track; null until it has been disbursed. */
    schedules: ScheduleRow[] | null;
};
export type ManagementCapabilities = { register: boolean; approvals: boolean; disbursements: boolean };
export type ApplicationDetail = ApplicationRow & {
    stages: { levelOrder: number; stageName: string; roleName: string }[];
    decisions: { id: string; action: string; stageName: string | null; remarks: string | null; actorName: string; createdAt: string }[];
    preview: ReturnType<typeof previewInstallments>;
    employee: EmployeeProfileDetail;
    pastLoans: PastLoanRow[];
    /** Schemes the reviewer may move this loan to (with eligibility for this employee); null when the viewer cannot edit. */
    editOptions: { schemes: ApplicationOption[] } | null;
    disbursementStatus: 'Disbursed' | 'Awaiting disbursement' | 'Not disbursed';
    disbursedAt: string | null;
    /** Paid/outstanding come from the posted repayment allocations; null until the loan is disbursed. */
    repayment: {
        paidAmount: number; outstandingAmount: number; remainingPrincipal: number;
        schedules: ScheduleRow[];
    } | null;
};
export type ApplicationList = {
    items: ApplicationRow[]; page: number; pageSize: number; total: number; capabilities: ManagementCapabilities;
    /** Salary day of the month from the workflow master; only filled for the disbursements tab. */
    salaryDay: number | null;
};

export const repaymentSchema = z.object({
    loanId: z.string().min(1, 'Loan is required'),
    amount: z.number().positive('Repayment amount must be positive'),
    paymentMode: z.enum(['CASH', 'BANK_TRANSFER', 'CHEQUE', 'UPI']),
    paymentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Valid payment date required (YYYY-MM-DD)'),
    reference: z.string().max(100).optional().nullable(),
    remarks: z.string().max(500).optional().nullable(),
    expectedVersion: z.number().int().positive('Expected version required'),
}).strict();
export type RepaymentInput = z.infer<typeof repaymentSchema>;

/** Early settlement is paid in Cash or by Bank Transfer only; a bank transfer must carry its UTR / reference. */
export const SETTLEMENT_PAYMENT_MODES = ['CASH', 'BANK_TRANSFER'] as const;
export const settlementSchema = z.object({
    loanId: z.string().min(1, 'Loan is required'),
    paymentMode: z.enum(SETTLEMENT_PAYMENT_MODES),
    settlementDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Valid settlement date required (YYYY-MM-DD)'),
    reference: z.string().trim().max(100).optional().nullable(),
    remarks: z.string().max(500).optional().nullable(),
    expectedVersion: z.number().int().positive('Expected version required'),
    /** The amount the user was quoted; the settlement is refused if the server now computes a different one. */
    expectedAmount: z.number().finite().nonnegative().optional(),
}).strict().superRefine((data, ctx) => {
    if (data.paymentMode === 'BANK_TRANSFER' && !data.reference) {
        ctx.addIssue({ code: 'custom', path: ['reference'], message: 'Enter the payment reference / UTR number for a bank transfer' });
    }
});
export type SettlementInput = z.infer<typeof settlementSchema>;

export type ScheduleRow = {
    id: string;
    installmentNo: number;
    dueDate: string;
    principalDue: number;
    interestDue: number;
    totalDue: number;
    principalPaid: number;
    interestPaid: number;
    totalPaid: number;
    principalOutstanding: number;
    interestOutstanding: number;
    totalOutstanding: number;
    /** Date of the latest posted repayment applied to this installment. */
    paymentDate: string | null;
    status: 'PAID' | 'PARTIAL' | 'PENDING' | 'OVERDUE';
};

export type RepaymentTransactionRow = {
    id: string;
    type: string;
    status: string;
    transactionDate: string;
    amount: number;
    paymentMode: string | null;
    reference: string | null;
    remarks: string | null;
    createdByName: string;
    createdAt: string;
};

export type LoanRepaymentSummary = {
    loan: {
        id: string;
        loanNumber: string;
        employeeId: string;
        employeeName: string;
        employeeCode: string | null;
        branchName: string;
        schemeName: string;
        status: string;
        disbursedAt: string | null;
        principalAmount: number;
        tenureMonths: number;
        interestType: StaffLoanInterestType;
        annualInterestRate: number;
        recoveryMethod: string;
        version: number;
    };
    summary: {
        totalPrincipalDue: number;
        totalInterestDue: number;
        totalPayable: number;
        totalPrincipalPaid: number;
        totalInterestPaid: number;
        totalPaid: number;
        principalOutstanding: number;
        interestOutstanding: number;
        totalOutstanding: number;
        nextInstallmentAmount: number | null;
        nextDueDate: string | null;
    };
    earlySettlement: {
        outstandingPrincipal: number;
        settlementInterest: number;
        waivedInterest: number;
        settlementPayoffAmount: number;
        futureInterestPolicy: 'COLLECT_REMAINING' | 'WAIVE_FUTURE';
    };
    schedules: ScheduleRow[];
    transactions: RepaymentTransactionRow[];
};
