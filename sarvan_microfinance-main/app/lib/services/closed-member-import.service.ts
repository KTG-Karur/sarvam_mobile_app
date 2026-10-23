import * as XLSX from 'xlsx';
import type { GoldLoanDetailsInput } from '@/app/lib/services/backup-loan.service';
import type { CenterSummary, GroupSummary } from '@/app/lib/services/uploan-import.service';

/**
 * "Closed Loan Member Upload" bulk import — parsing + client-safe helpers for legacy
 * members whose loan is ALREADY closed, uploaded only to migrate their unreturned
 * Savings/Thrift and/or unreturned pledged Gold. Sibling to uploan-import.service.ts
 * (the ongoing-loan "Member Upload" importer) — no Branch Wise Repayment join here, since
 * there's no ongoing schedule to replay.
 *
 * Deliberately kept free of any Prisma/server-only imports for the same reason as
 * uploan-import.service.ts: components/masters/ClosedMemberUploanClient.tsx ('use client')
 * imports CLOSED_MEMBER_TEMPLATE_HEADERS from here. The actual DB-touching validation
 * logic lives in closed-member-validate.service.ts instead.
 */

/** Header (Excel) -> internal field key. Also drives the downloadable template's headers. */
export const CLOSED_MEMBER_COLUMN_MAP: Record<string, string> = {
    Name: 'name',
    Phone: 'mobileNumber',
    Email: 'email',
    DOB: 'dateOfBirth',
    Age: 'age',
    Gender: 'gender',
    'Economic Activity Name': 'occupation',
    Citizenship: 'country',
    Branch: 'branchNameRef',
    Center: 'centerName',
    Group: 'groupName',
    'Officer Name': 'fdoName',
    Address: 'address',
    'Permanent Address': 'permanentAddress',
    District: 'district',
    'Rate of State': 'state',
    PinCode: 'pincode',
    'House Latitude': 'latitude',
    'House Longitude': 'longitude',
    'Local Area': 'localArea',
    'Meeting Day': 'meetingDay',
    'Meeting Time': 'meetingTime',
    'Aadhar Number': 'otherIdNo',
    PanCard: 'pancardNo',
    'ID Proof': 'idProofType',
    'ID Proof No.': 'idProofNo',
    Caste: 'caste',
    'Spouse Name': 'spouseName',
    'Spouse DOB': 'spouseDob',
    'Nominee Name': 'nomineeName',
    'Nominee DOB': 'nomineeDateOfBirth',
    'Nominee Age': 'nomineeAge',
    'Nominee Relationship': 'nomineeRelation',
    'Nominee Phone Number': 'nomineePhone',
    'Nominee Aathar Number': 'nomineeAadhaar',
    'Nominee Voter ID Number': 'nomineeVoterId',
    'Member Status': 'memberStatus',
    'MemberisVerified': 'memberVerified',
    'Dead Member': 'deadMember',
    'Account Number': 'bankAcNo',
    'IFSC code': 'ifscCode',
    'Bank Name': 'bankName',
    'Bank Branch Name': 'bankBranch',
    'Account Type': 'bankAccountType',
    'Annual Income': 'annualIncome',
    // Closure / loan fields — 'Loan MemberID' reuses the SAME header extractUploanLoanId
    // already knows how to find, so a legacy Loan ID carried over from the ongoing-loan
    // export still resolves here.
    'Product Type': 'productTypeName',
    'Product Name': 'productName',
    'Purpose of Loan': 'loanPurposeName',
    'Funding Line': 'funderName',
    'Loan Principal': 'loanPrincipal',
    'Loan Interest': 'loanInterest',
    'Loan Disbursement Date': 'disbursementDate',
    // Legacy exports have been seen with a trailing space on this exact header
    // ("Closed Date ") — the lookup in parseClosedMemberWorkbook below trims header
    // whitespace before matching, so this key doesn't need to guess the exact spacing.
    'Closed Date': 'closedDate',
    'Closure Reason': 'closureReasonRef',
    'Unreturned Savings Amount': 'unreturnedSavingsRef',
};

/** Column headers in a stable order for the downloadable template. */
export const CLOSED_MEMBER_TEMPLATE_HEADERS = Object.keys(CLOSED_MEMBER_COLUMN_MAP);

export interface ClosedMemberRow {
    rowId: string;
    raw: Record<string, unknown>;
    [key: string]: unknown;
}

function cellValue(val: unknown): string {
    if (val === null || val === undefined) return '';
    if (typeof val === 'number') {
        return Number.isInteger(val) ? val.toFixed(0) : String(val);
    }
    return String(val).trim();
}

/** Exact match first (the common, fast case), falling back to a whitespace-trimmed
 *  comparison against every actual column header in this row — legacy exports have been
 *  seen with stray leading/trailing spaces on an otherwise-correct header (e.g.
 *  "Closed Date " instead of "Closed Date"), which a plain `row[key]` lookup silently
 *  treats as a missing column instead of matching it. */
function cell(row: Record<string, unknown>, key: string): string {
    if (key in row) return cellValue(row[key]);
    const keyTrimmed = key.trim().toLowerCase();
    for (const actualHeader of Object.keys(row)) {
        if (actualHeader.trim().toLowerCase() === keyTrimmed) return cellValue(row[actualHeader]);
    }
    return '';
}

/** First parse from an uploaded workbook — assigns a stable rowId per row. */
export function parseClosedMemberWorkbook(buffer: ArrayBuffer): ClosedMemberRow[] {
    const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const rawRows = XLSX.utils.sheet_to_json(worksheet, { raw: true, defval: '' }) as Record<string, unknown>[];

    return rawRows.map((row, index) => {
        const mapped: ClosedMemberRow = { rowId: `row-${index + 1}`, raw: row };
        for (const [header, field] of Object.entries(CLOSED_MEMBER_COLUMN_MAP)) {
            mapped[field] = cell(row, header);
        }
        return mapped;
    });
}

export interface ValidatedClosedMemberRow extends ClosedMemberRow {
    status: 'VALID' | 'ERROR';
    errors: string[];
    warnings: string[];
    disbursementDateResolved: string;
    closedDateResolved: string;
    dateOfBirthResolved: string;
    spouseDobResolved: string;
    nomineeDateOfBirthResolved: string;
    resolved: {
        centerKey: string;
        centerStatus: 'MATCHED' | 'NEW';
        centerId?: string;
        groupKey: string;
        groupStatus: 'MATCHED' | 'NEW';
        groupId?: string;
        clientStatus: 'MATCHED_EXISTING' | 'NEW';
        clientId?: string;
        /** Only resolved (and only required) when the job's global createLoan toggle is
         * true — a bare-shell Loan (createLoan: false) never needs a product. */
        loanProductId?: string;
        loanPurposeId?: string;
        funderId?: string | null;
        closureReason?: 'DEAD' | 'WRITEOFF' | 'OTHERS';
        /** Amount still owed back to this member — sourced from the row's own
         * "Unreturned Savings Amount" column, or the optional Loan-Advance Outstanding
         * Report when uploaded (same "seed from file, admin edit wins" contract as the
         * ongoing-loan importer's loanAdvanceOutstanding). */
        unreturnedSavings: number;
        goldLoanDetails?: GoldLoanDetailsInput;
    };
}

export interface ClosedMemberPreviewResult {
    centers: CenterSummary[];
    groups: GroupSummary[];
    rows: ValidatedClosedMemberRow[];
    totalRows: number;
    validRows: number;
    errorRows: number;
}
