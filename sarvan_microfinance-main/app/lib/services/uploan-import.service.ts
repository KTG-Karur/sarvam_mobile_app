import * as XLSX from 'xlsx';
// Type-only import — elided entirely at compile time (no runtime module reference), so this
// never pulls backup-loan.service.ts's Prisma-touching code into the client bundle. See this
// file's own header comment for why that constraint matters here.
import type { GoldLoanDetailsInput } from '@/app/lib/services/backup-loan.service';

/**
 * upload "Member upload" bulk import — parsing + client-safe helpers for a legacy-system
 * Excel export (one row = one member + their one ongoing/backup loan).
 *
 * Deliberately kept free of any Prisma/server-only imports: components/masters/
 * MemberUploanClient.tsx ('use client') imports UPLOAN_TEMPLATE_HEADERS from here, and an
 * ES module import pulls in a file's ENTIRE dependency graph regardless of which export is
 * used — a Prisma runtime import anywhere in this file's chain breaks the client bundle
 * (Turbopack: "chunking context does not support external modules (request: node:module)").
 * The actual DB-touching validation logic lives in uploan-validate.service.ts instead,
 * imported only by API routes/the import worker, never by this component.
 */

/** Header (Excel) -> internal field key. Also drives the downloadable template's headers. */
export const UPLOAN_COLUMN_MAP: Record<string, string> = {
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
    'Purpose of Loan': 'loanPurposeName',
    'Product Type': 'productTypeName',
    'Product Name': 'productName',
    'Product Amount': 'productAmountRef',
    'Rate of Interest': 'interestRateRef',
    'No.Of Installments': 'installmentsRef',
    'Loan Disbursement Date': 'disbursementDate',
    'Loan Start Date': 'scheduleStartDate',
    'Collection Day': 'collectionDay',
    'Loan Principal': 'loanPrincipal',
    'Loan Interest': 'loanInterest',
    'Outstanding Principal': 'outstandingPrincipal',
    'Outstanding Interest': 'outstandingInterest',
    'Thrift 1': 'thrift1',
    'Thrift 2': 'thrift2',
    'Funding Line': 'funderName',
    'Last RepayDate': 'lastRepayDate',
    'Account Number': 'bankAcNo',
    'IFSC code': 'ifscCode',
    'Bank Name': 'bankName',
    'Bank Branch Name': 'bankBranch',
    'Account Type': 'bankAccountType',
    'Annual Income': 'annualIncome',
    'Is PreClosed': 'isPreClosed',
    'Asset Type': 'assetType',
    'Dead Member': 'deadMember',
};

/** Column headers in a stable order for the downloadable template — derived from the
 * same map the parser reads, so headers can never drift out of sync with parsing. */
export const UPLOAN_TEMPLATE_HEADERS = Object.keys(UPLOAN_COLUMN_MAP);

export interface UploanRow {
    rowId: string;
    raw: Record<string, unknown>;
    [key: string]: unknown;
}

/** Header spellings seen in legacy exports for the member/client identifier that joins
 * a member row to its Loan Card Report / Repayment Report (matched by content, not
 * filename — see uploan-loan-history.service.ts). Compared case/whitespace/punctuation-
 * insensitive so "Member ID", "MemberId", "Client_ID" etc. all resolve the same way. */
const MEMBER_ID_HEADER_CANDIDATES = ['memberid', 'clientid', 'membercode', 'clientcode', 'memberno', 'clientno'];

function normalizeHeader(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Pulls the legacy member/client ID out of a row's raw (un-mapped) Excel columns —
 * shared by both the server-side matcher and the client-side "which badge to show"
 * logic so they can never disagree about which rows have matched history. */
export function extractUploanMemberId(raw: Record<string, unknown> | null | undefined): string {
    if (!raw) return '';
    for (const [key, value] of Object.entries(raw)) {
        if (MEMBER_ID_HEADER_CANDIDATES.includes(normalizeHeader(key))) {
            const str = String(value ?? '').trim();
            if (str) return str;
        }
    }
    return '';
}

export interface ParsedUploanMemberId {
    branchCode: string;
    centerCode: string;
    groupCode: string;
    groupNumber: number;
    memberSeq: string;
}

/** Splits a legacy MemberID ("33-1-1-1" = branch 33, center 1, group 1, seat 1) into its
 *  four positional segments — this is the SAME `{branchCode}-{centerCode}-{groupCode}-{seq}`
 *  shape this app's own Client.clientId generator already produces (see
 *  client-enrollment.service.ts), confirmed against a real legacy export
 *  (sample excel/Theni 060626.xlsx, 29/29 rows). Used only by the uploan/member import path
 *  to derive Center/Group/Client IDs verbatim from the source file — nowhere else. */
export function parseUploanMemberId(memberId: string): ParsedUploanMemberId | null {
    const parts = memberId.trim().split('-').map((p) => p.trim()).filter(Boolean);
    if (parts.length !== 4) return null;
    const [branchCode, centerCode, groupCode, memberSeq] = parts;
    if (!/^\d+$/.test(groupCode)) return null; // Group.groupNumber is Int
    return { branchCode, centerCode, groupCode, groupNumber: parseInt(groupCode, 10), memberSeq };
}

/** Strips a leading "<code>-" prefix off a legacy Center name column (e.g. "154-
 *  ARANMANAIPUDHUR" with code "154" -> "ARANMANAIPUDHUR") when that prefix numerically
 *  matches the parsed Center code from this row's MemberID. The code already lives on
 *  Center.code — leaving it baked into Center.name too doubles it up everywhere the app
 *  displays "<code> - <name>" (e.g. reports rendering "154-154-ARANMANAIPUDHUR"). Returns
 *  the text unchanged when it doesn't start with a matching numeric prefix, or when
 *  stripping would leave nothing behind. */
export function stripLegacyCodePrefix(text: string, code: string): string {
    const trimmed = text.trim();
    const match = trimmed.match(/^(\d+)-\s*(.*)$/);
    if (match && parseInt(match[1], 10) === parseInt(code, 10) && match[2].trim()) {
        return match[2].trim();
    }
    return trimmed;
}

/** Header spelling for the legacy per-LOAN numeric id that joins a Member Details Report
 * row to its Branch Wise Repayment rows (matched against that file's "Loan ID" column).
 * Deliberately narrow — the member file's OWN "Loan ID" column (normalizes to "loanid")
 * is a different, unrelated internal id that happens to also look plausible; only "Loan
 * MemberID" is verified to be the real join key (see uploan-branch-repayment.service.ts). */
const LOAN_ID_HEADER_CANDIDATES = ['loanmemberid'];

export function extractUploanLoanId(raw: Record<string, unknown> | null | undefined): string {
    if (!raw) return '';
    for (const [key, value] of Object.entries(raw)) {
        if (LOAN_ID_HEADER_CANDIDATES.includes(normalizeHeader(key))) {
            const str = String(value ?? '').trim();
            if (str) return str;
        }
    }
    return '';
}

const OFFICER_NAME_FALLBACK_HEADERS = ['Officer Name', 'Collection Staff', 'Collected By'];

/** A role/branch label like "BM - Oddanchatram" isn't a person and will never match a
 *  branch employee by name — treated the same as blank so the next candidate is tried. */
function looksLikeRoleLabel(name: string): boolean {
    return /^\s*(BM|AM|FDO|DM)\s*-/i.test(name);
}

/** "Officer Name" is the real collector for most rows, but some legacy rows show a role
 *  label instead ("BM - <Branch>") — for those, "Collection Staff" / "Collected By" on
 *  the same row names the actual person who collected this loan's history. */
export function resolveOfficerName(raw: Record<string, unknown> | null | undefined): string {
    if (!raw) return '';
    for (const header of OFFICER_NAME_FALLBACK_HEADERS) {
        const value = String(raw[header] ?? '').trim();
        if (value && !looksLikeRoleLabel(value)) return value;
    }
    return '';
}

/** Prefix-tolerant lookup for headers whose exact text changes per export — used only for
 *  Outstanding Principal/Interest, whose real header has a trailing "(As On <date>)" that
 *  changes every time the legacy system regenerates the report, so UPLOAN_COLUMN_MAP's
 *  exact-match lookup can never hit it. A plain `startsWith` naturally prefers the literal
 *  "Outstanding ..." column over the export's separate "Actual OutStanding ..." column
 *  (which doesn't share the same prefix), no special-casing needed. */
function findByHeaderPrefix(row: Record<string, unknown>, prefix: string): string {
    const prefixLower = prefix.trim().toLowerCase();
    for (const key of Object.keys(row)) {
        if (key.trim().toLowerCase().startsWith(prefixLower)) return cell(row, key);
    }
    return '';
}

function cellValue(val: unknown): string {
    if (val === null || val === undefined) return '';
    if (typeof val === 'number') {
        // Excel stores long ID-like numbers (Aadhaar, bank account) at full double
        // precision, but its own "General"/scientific display format is lossy
        // (e.g. shows "4.08323E+11" for 408323082642). Reading with raw:true below
        // gives us the true value — format it as a plain integer ourselves so we
        // never reintroduce that display-only rounding.
        return Number.isInteger(val) ? val.toFixed(0) : String(val);
    }
    return String(val).trim();
}

/** Exact match first (the common, fast case), falling back to a whitespace-trimmed
 *  comparison against every actual column header in this row — legacy exports have been
 *  seen with a stray leading/trailing space on an otherwise-correct header (e.g. a real
 *  closed-member export's "Closed Date " column), which a plain `row[key]` lookup
 *  silently treats as a missing column instead of matching it. */
function cell(row: Record<string, unknown>, key: string): string {
    if (key in row) return cellValue(row[key]);
    const keyTrimmed = key.trim().toLowerCase();
    for (const actualHeader of Object.keys(row)) {
        if (actualHeader.trim().toLowerCase() === keyTrimmed) return cellValue(row[actualHeader]);
    }
    return '';
}

/** First parse from an uploaded workbook — assigns a stable rowId per row. */
export function parseUploanWorkbook(buffer: ArrayBuffer): UploanRow[] {
    const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    // raw:true preserves full numeric precision (see `cell()` above) — raw:false
    // would bake in Excel's display formatting, which is where the Aadhaar/account
    // number corruption actually comes from.
    const rawRows = XLSX.utils.sheet_to_json(worksheet, { raw: true, defval: '' }) as Record<string, unknown>[];

    return rawRows.map((row, index) => {
        const mapped: UploanRow = { rowId: `row-${index + 1}`, raw: row };
        for (const [header, field] of Object.entries(UPLOAN_COLUMN_MAP)) {
            mapped[field] = cell(row, header);
        }
        // 'Outstanding Principal'/'Outstanding Interest' never match via the exact-header
        // lookup above — see findByHeaderPrefix's doc comment.
        if (!mapped.outstandingPrincipal) mapped.outstandingPrincipal = findByHeaderPrefix(row, 'Outstanding Principal');
        if (!mapped.outstandingInterest) mapped.outstandingInterest = findByHeaderPrefix(row, 'Outstanding Interest');
        return mapped;
    });
}

export function splitName(fullName: string): { firstName: string; lastName: string } {
    const trimmed = fullName.trim().replace(/\s+/g, ' ');
    const lastSpace = trimmed.lastIndexOf(' ');
    if (lastSpace === -1) return { firstName: trimmed, lastName: '' };
    return { firstName: trimmed.slice(0, lastSpace), lastName: trimmed.slice(lastSpace + 1) };
}

export function toNumber(val: unknown): number | null {
    if (val === null || val === undefined || val === '' || val === '-') return null;
    const n = Number(String(val).replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
}

export function parseFlexibleDate(val: unknown): Date | null {
    const str = String(val ?? '').trim();
    if (!str || str === '-') return null;
    // YYYY-MM-DD (already ISO)
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
        const d = new Date(str);
        return isNaN(d.getTime()) ? null : d;
    }
    // DD-MM-YYYY, optionally with a trailing time-of-day the date value itself never
    // needs (e.g. a real closed-member export's "Closed Date" column: "13-04-2026 19:14
    // PM" — the caller only ever wants the calendar date). Matched against just the
    // leading date token rather than the whole string, so a trailing time never breaks
    // the match.
    const datePart = str.split(/\s+/)[0];
    const dmY = datePart.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (dmY) {
        const d = new Date(`${dmY[3]}-${dmY[2].padStart(2, '0')}-${dmY[1].padStart(2, '0')}`);
        return isNaN(d.getTime()) ? null : d;
    }
    const generic = new Date(str);
    return isNaN(generic.getTime()) ? null : generic;
}

export function toYmd(d: Date): string {
    return d.toISOString().slice(0, 10);
}

/** Optional date field (DOB-type columns): blank/`-` is fine, but anything present that
 * doesn't parse is a validation error — never let it through to Import, where a raw
 * `new Date(str)` on an unparseable value produces an Invalid Date that Prisma rejects. */
export function resolveOptionalDate(raw: unknown, label: string, errors: string[]): string {
    const str = String(raw ?? '').trim();
    if (!str || str === '-') return '';
    const parsed = parseFlexibleDate(str);
    if (!parsed) {
        errors.push(`${label} could not be parsed — use a valid date or leave blank`);
        return '';
    }
    return toYmd(parsed);
}

export interface CenterSummary {
    key: string;
    name: string;
    status: 'MATCHED' | 'NEW';
    id?: string;
    /** Exact Center code parsed from this row's legacy MemberID — set only when parsing
     *  succeeded; used to look up/create the Center by code instead of by name. */
    code?: string;
    meetingDay?: string | null;
    meetingTime?: string | null;
    address?: string | null;
    localArea?: string | null;
    rowCount: number;
}

/** Admin-supplied corrections for a NEW center, keyed by CenterSummary.key. Ignored for MATCHED centers. */
export type CenterOverrides = Record<
    string,
    { meetingDay?: string; meetingTime?: string; address?: string; localArea?: string }
>;

export interface GroupSummary {
    key: string;
    centerKey: string;
    centerName: string;
    legacyGroupName: string;
    status: 'MATCHED' | 'NEW';
    id?: string;
    /** Exact Group code/number parsed from this row's legacy MemberID — set only when
     *  parsing succeeded; used to look up/create the Group by code instead of auto-numbering. */
    code?: string;
    groupNumber?: number;
    rowCount: number;
}

export interface ValidatedUploanRow extends UploanRow {
    status: 'VALID' | 'ERROR';
    errors: string[];
    /** Non-blocking, informational notices (e.g. "gold pledge record found but current
     * loan product isn't a gold product — skipped") — unlike `errors`, these never affect
     * `status`. */
    warnings: string[];
    resolved: {
        centerKey: string;
        centerStatus: 'MATCHED' | 'NEW';
        centerId?: string;
        groupKey: string;
        groupStatus: 'MATCHED' | 'NEW';
        groupId?: string;
        clientStatus: 'MATCHED_EXISTING' | 'NEW';
        clientId?: string;
        loanProductId?: string;
        loanPurposeId?: string;
        funderId?: string | null;
        paidPrincipal: number;
        paidInterest: number;
        /** True once this row's Loan MemberID matched at least one collected installment in
         * the Branch Wise Repayment file — reflects the join only. A row can have
         * hasLoanHistory: true and still be status: 'ERROR' for an unrelated reason (Loan
         * Officer not resolvable to a branch employee, LoanProduct schedule-template
         * shortfall, etc.) — check `errors` for those. */
        hasLoanHistory: boolean;
        /** True when the Branch Wise Repayment file has no rows for this loan AND the
         * Member Details Report's own Outstanding Principal/Interest columns agree
         * nothing has been collected yet (paidPrincipal/paidInterest both 0) — a
         * legitimately brand-new, never-collected loan, not a join/data problem. Such a
         * row is NOT an error; it imports with just the future schedule (no past
         * transactions to replay). Mutually exclusive with hasLoanHistory. */
        isNewUncollectedLoan: boolean;
        /** Employee (User) this row's resolved Officer Name (falling back to Collection
         * Staff / Collected By) matched to, within the target branch — set only when
         * exactly one branch employee matches. */
        loanOfficerId?: string;
        /** Sum of "Balance Loan Advance O/S" across every one of this member's loan cycles
         * in the Thrift/Loan-Advance Outstanding Report, keyed by (MemberID, Name) —
         * replaces the legacy Thrift1+Thrift2 current-loan-only sum when that report was
         * uploaded this import run. `undefined` (not `0`) when no such report was uploaded
         * at all this run, so the consumer can fall back to the legacy sum; `0` when the
         * report WAS uploaded but this specific member has no rows in it (no prior
         * loan-advance history — a real, valid value, not a missing one). */
        loanAdvanceOutstanding?: number;
        /** Populated only when this row's (MemberID, Name) matched a row in the uploaded
         * Gold Loan Details report AND the resolved loanProductId's LoanProductType is a
         * gold product per isGoldLoanProduct() — editable in the preview grid (karatType
         * defaults to '22K', cashGiven defaults to the same figure as goldTakenValue since
         * the source file has no separate cash-disbursed column). */
        goldLoanDetails?: GoldLoanDetailsInput;
    };
}

export interface UploanPreviewResult {
    centers: CenterSummary[];
    groups: GroupSummary[];
    rows: ValidatedUploanRow[];
    totalRows: number;
    validRows: number;
    errorRows: number;
}


/** Order/initial-tolerant name key: "G Sankar Kumar" and a User stored as
 * firstName "Sankar Kumar" + lastName "G" both collapse to "g kumar sankar" —
 * legacy reports and this system's firstName/lastName split don't agree on
 * word order, so token-set equality is the only comparison that isn't
 * spuriously strict. Periods are treated as a token separator (replaced with a
 * space), not simply deleted — a legacy report's "P.Sivapandi" (initial +
 * surname, no space after the period) must still split into two tokens
 * ["p","sivapandi"] to match a User stored as firstName "P" + lastName
 * "Sivapandi" ("P Sivapandi" -> ["p","sivapandi"]); deleting the period
 * outright would merge them into one token ("psivapandi") and never match. */
export function nameTokenKey(fullName: string): string {
    return fullName
        .toLowerCase()
        .replace(/\./g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .sort()
        .join(' ');
}

/** Case/whitespace-normalized MemberID — the reused branch/center/group/seat slot code
 * shared across the Thrift-Outstanding and Gold-Details reports (NOT a stable person id —
 * verified 8/475 multi-row MemberIDs in a real Thrift Outstanding Report sample actually
 * span two different people). Used as the Gold-Details join key on its own (paired with
 * namesLooselyOverlap as a non-blocking safety check, not baked into the key itself — a
 * strict composite key was found to drop real matches whose name is shortened/informal in
 * that export) and as one half of buildMemberNameKey below (used where the strict/exact
 * composite key is still the right tradeoff — see that function's own doc comment). */
export function normalizeMemberId(memberId: string): string {
    return memberId.trim().toUpperCase();
}

/** Strict join key for the Thrift-Outstanding report: MemberID alone is unsafe (see
 * normalizeMemberId's doc comment), and unlike Gold-Details this join directly sets
 * Client.loanAdvance (a live withdrawal-cap balance) — a wrong match here *merges* an
 * unrelated person's balance into the wrong client, not just mis-tags metadata, so the
 * stricter exact-name-match key is the right tradeoff for this one file. */
export function buildMemberNameKey(memberId: string, name: string): string {
    return `${normalizeMemberId(memberId)}::${nameTokenKey(name)}`;
}

/** Loose/partial name match — true if any name token in `a` is a prefix of, or shares a
 * prefix with, any token in `b` (case/whitespace-insensitive). Deliberately more permissive
 * than nameTokenKey's exact token-set equality: handles a legacy export using a shortened
 * first name only ("SANTHI") against another export's fuller name ("SANTHI SEKAR"), while
 * still rejecting names that don't resemble each other at all — used as a non-blocking
 * safety check on Gold-Details rows matched by MemberID alone (see normalizeMemberId). */
export function namesLooselyOverlap(a: string, b: string): boolean {
    const tokensA = a.toUpperCase().split(/\s+/).filter(Boolean);
    const tokensB = b.toUpperCase().split(/\s+/).filter(Boolean);
    return tokensA.some((ta) => tokensB.some((tb) => ta === tb || ta.startsWith(tb) || tb.startsWith(ta)));
}

