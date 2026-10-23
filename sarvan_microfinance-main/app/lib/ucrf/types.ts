import { z } from 'zod';

/** Institution-level header/trailer settings, persisted in `UcrfInstitutionConfig`. */
export interface UcrfConfig {
    /** Member ID assigned by the CIC (header field 4, ≤10 A/N). */
    memberId: string;
    /** Submitting Member Name (header field 5, ≤30). */
    institutionName: string;
    /** Submitting Branch Id (header field 6, ≤30, optional). */
    submittingBranchId: string;
    /** File Frequency (header field 12): DL/W1/W2/W3/ME/DC/AH/RR. */
    fileFrequency: string;
    /** Old Member Id (header field 10, optional, mandatory for migrated-case files). */
    oldMemberId: string;
    /** Loan Category reported for every account: T01 JLG Group / T02 JLG Individual / T03 Individual. */
    loanCategory: string;
}

export type UcrfSegment = 'CNSCRD' | 'ADRCRD' | 'ACTCRD';
export type UcrfCharType = 'A' | 'N' | 'A/N' | 'P';
export type UcrfOption = 'Mandatory' | 'Optional' | 'Conditional';

/** Normalised, DB-agnostic snapshot of one loan (account) and its member, built by the dataset service. */
export interface UcrfLoanInput {
    loanId: string;
    loanNumber: string;
    client: {
        /** Internal Client.id — Client.clientId (the reported Member Identifier) is not unique by design. */
        dbId: string;
        clientId: string;
        firstName: string;
        lastName: string;
        gender: string | null;
        dobYmd: string | null;
        maritalStatus: string | null;
        fatherName: string | null;
        motherName: string | null;
        spouseName: string | null;
        spouseGender: string | null;
        nomineeName: string | null;
        nomineeRelation: string | null;
        votersIdNo: string | null;
        /** Aadhaar — the app stores it in Client.otherIdNo. */
        aadhaar: string | null;
        pancardNo: string | null;
        mobileNumber: string | null;
        phone: string | null;
        email: string | null;
        qualification: string | null;
        bankName: string | null;
        ifscCode: string | null;
        bankAcNo: string | null;
        monthlyFamilyIncome: number | null;
        monthlyFamilyExpense: number | null;
        religion: string | null;
        caste: string | null;
        permanentAddress: string | null;
        state: string | null;
        pincode: string | null;
    };
    branch: { id: string; code: string; name: string };
    center: { code: string; name: string };
    /** Group identifier reported to the bureau; null when the member has no group. */
    groupIdentifier: string | null;
    productName: string | null;
    purposeName: string | null;
    frequency: string | null;
    appliedAmount: number | null;
    amount: number;
    disbursedYmd: string | null;
    closedYmd: string | null;
    disbursementStatus: string;
    closureReason: string | null;
    schedules: Array<{
        dueYmd: string;
        principalDue: number;
        interestDue: number;
        status: string;
        /** Ledger-derived (approved, non-reversed) principal/interest paid up to the report cut-off. */
        principalPaid: number;
        interestPaid: number;
    }>;
    lastPaymentYmd: string | null;
    writeOff: { amount: number; ymd: string } | null;
    loanCycle: number | null;
    insurance: { policyType: string; coverageAmount: number } | null;
}

export interface UcrfValidationIssue {
    loanId: string;
    loanNumber: string;
    memberId: string;
    /** 1-based UCRF field number (0 for record/file-level). */
    fieldNo: number;
    field: string;
    /** Masked/truncated value, safe to show. */
    value: string;
    reason: string;
    suggestion?: string;
    /** error → record excluded from the CDF; warning → included, field blanked or noted. */
    severity: 'error' | 'warning';
}

export interface UcrfRecord {
    loanId: string;
    loanNumber: string;
    memberId: string;
    /** Internal Client.id (never exported). */
    clientDbId: string;
    memberName: string;
    branchId: string;
    branchCode: string;
    branchName: string;
    centerCode: string;
    centerName: string;
    groupIdentifier: string | null;
    productName: string | null;
    accountStatus: string;
    disbursementDate: string | null;
    closedDate: string | null;
    disbursedAmount: number;
    installmentAmount: number;
    installments: number;
    outstandingBalance: number;
    overdueAmount: number;
    dpd: number;
    /** The 100 positional UCRF fields for this member/account (index 0 = field 1). */
    fields: string[];
    issues: UcrfValidationIssue[];
    isValid: boolean;
}

export interface UcrfDatasetSummary {
    reportDate: string;
    totalMembers: number;
    totalRecords: number;
    validRecords: number;
    invalidRecords: number;
    warningRecords: number;
}

export const ymdSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

export const ucrfFiltersSchema = z.object({
    /** Report ("as of") date, YYYY-MM-DD. Must not be in the future. */
    reportDate: ymdSchema,
    branchId: z.string().trim().min(1).max(64).optional(),
    loanProductId: z.string().trim().min(1).max(64).optional(),
    /** ACTIVE = disbursed & open, CLOSED = closed within the reporting month, ALL = both. */
    loanStatus: z.enum(['ALL', 'ACTIVE', 'CLOSED']).default('ALL'),
    search: z.string().trim().max(100).optional(),
    validity: z.enum(['ALL', 'VALID', 'INVALID']).default('ALL'),
});
export type UcrfFilters = z.infer<typeof ucrfFiltersSchema>;

export const ucrfPageSchema = z.object({
    page: z.number().int().min(1).default(1),
    pageSize: z.number().int().min(1).max(200).default(25),
    sortBy: z
        .enum(['memberId', 'memberName', 'branchName', 'loanNumber', 'disbursementDate', 'disbursedAmount', 'outstandingBalance', 'overdueAmount', 'dpd', 'status'])
        .default('loanNumber'),
    sortDir: z.enum(['asc', 'desc']).default('asc'),
});
export type UcrfPageParams = z.infer<typeof ucrfPageSchema>;

export const ucrfConfigSchema = z.object({
    memberId: z.string().trim().min(1, 'Member ID is required').max(10, 'Member ID must be at most 10 characters').regex(/^[A-Za-z0-9]+$/, 'Member ID must be alphanumeric'),
    institutionName: z.string().trim().min(1, 'Institution name is required').max(30, 'Institution name must be at most 30 characters').regex(/^[\x20-\x7E]+$/, 'Printable ASCII only'),
    submittingBranchId: z.string().trim().max(30).regex(/^[\x20-\x7E]*$/, 'Printable ASCII only').default(''),
    fileFrequency: z.enum(['DL', 'W1', 'W2', 'W3', 'ME', 'DC', 'AH', 'RR']).default('ME'),
    oldMemberId: z.string().trim().max(30).regex(/^[\x20-\x7E]*$/, 'Printable ASCII only').default(''),
    loanCategory: z.enum(['T01', 'T02', 'T03']).default('T02'),
});

export const ucrfExportBodySchema = z.object({
    format: z.enum(['cdf', 'csv', 'xlsx', 'json', 'errors']),
    filters: ucrfFiltersSchema,
});
