import {
    mapCaste,
    mapEducation,
    mapGender,
    mapMaritalStatus,
    mapRelationship,
    mapReligion,
    mapRepaymentFrequency,
    resolveStateCode,
    UCRF_LAYOUT_VERSION,
} from './codes';
import { cleanText, digitsOnly, ymdToDdmmyyyy } from './format';
import { isValidAadhaar, isValidPan, isValidVoterId, normalizePhone, isValidIndianPhone } from './id-validation';
import type { AccountState } from './financials';
import type { UcrfCharType, UcrfConfig, UcrfLoanInput, UcrfOption, UcrfSegment, UcrfValidationIssue } from './types';

/**
 * Explicit UCRF v3.3.1 ↔ application mapping (JLG + Individual layout, 100 columns:
 * CNSCRD 1-55, ADRCRD 56-63, ACTCRD 64-100). One entry per official field; `source` and `rule`
 * document where the value comes from and how it is transformed. Fields with no `build` have no
 * reliable source in this schema and are emitted blank (separator preserved) — they are all
 * Optional/Reserved in the spec; see UCRF_UNMAPPED_NOTES.
 */
export interface FieldContext {
    input: UcrfLoanInput;
    config: UcrfConfig;
    reportYmd: string;
    state: AccountState;
    /** Records a non-fatal issue (value was blanked / adjusted) so it is shown, never silent. */
    warn: (fieldNo: number, field: string, value: string, reason: string, suggestion?: string) => void;
}

export interface FieldDef {
    no: number;
    segment: UcrfSegment;
    name: string;
    type: UcrfCharType;
    length: number;
    option: UcrfOption;
    /** Application source (Prisma model.field) or derivation. */
    source: string;
    /** Transformation / validation / null behaviour. */
    rule: string;
    build?: (c: FieldContext) => string;
}

function def(
    no: number,
    segment: UcrfSegment,
    name: string,
    type: UcrfCharType,
    length: number,
    option: UcrfOption,
    source: string,
    rule: string,
    build?: (c: FieldContext) => string
): FieldDef {
    return { no, segment, name, type, length, option, source, rule, build };
}

const RESERVED = 'No source — Reserved for future use; blank';
const NO_SOURCE = 'No reliable source in the schema; blank (optional field)';

function relationCode(spouseGender: string | null, fallback: 'K02' | 'K06'): 'K02' | 'K06' {
    const g = mapGender(spouseGender);
    if (g === 'M') return 'K02';
    if (g === 'F') return 'K06';
    return fallback;
}

/** Husband for a female member, wife for a male member, when the spouse's gender isn't recorded. */
function spouseRelation(c: FieldContext): string {
    const own = mapGender(c.input.client.gender);
    return relationCode(c.input.client.spouseGender, own === 'M' ? 'K06' : 'K02');
}

function keyPerson(c: FieldContext): { name: string; rel: string } | null {
    const cl = c.input.client;
    if (cl.spouseName && cleanText(cl.spouseName)) return { name: cleanText(cl.spouseName), rel: spouseRelation(c) };
    if (cl.fatherName && cleanText(cl.fatherName)) return { name: cleanText(cl.fatherName), rel: 'K01' };
    return null;
}

/** Optional ID: emitted only when it passes the spec's format check; otherwise blanked with a warning. */
function optionalId(
    c: FieldContext,
    no: number,
    field: string,
    raw: string | null,
    normalise: (v: string) => string,
    valid: (v: string) => boolean
): string {
    const v = normalise(raw ?? '');
    if (!v) return '';
    if (valid(v)) return v;
    c.warn(no, field, v, `${field} fails the UCRF format check and was left blank`, 'Correct the number in the client record');
    return '';
}

function alnumUpper(v: string): string {
    return v.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function addressValues(c: FieldContext) {
    const cl = c.input.client;
    const stateCode = resolveStateCode(cl.state) ?? '';
    return { address: cleanText(cl.permanentAddress), stateCode, pin: digitsOnly(cl.pincode) };
}

function centreId(c: FieldContext): string {
    const b = cleanText(c.input.branch.code);
    const k = cleanText(c.input.center.code);
    return b && k ? `${b}-${k}` : k;
}

function phoneOf(c: FieldContext): string {
    return normalizePhone(c.input.client.mobileNumber) || normalizePhone(c.input.client.phone);
}

export const UCRF_FIELDS: FieldDef[] = [
    // ── CNSCRD — Member/Consumer segment ───────────────────────────────────────────────
    def(1, 'CNSCRD', 'Segment Identifier', 'A/N', 6, 'Mandatory', 'Constant', 'Literal "CNSCRD"', () => 'CNSCRD'),
    def(2, 'CNSCRD', 'Member Identifier', 'P', 35, 'Mandatory', 'Client.clientId', 'Trimmed; must contain a non-special character', (c) => cleanText(c.input.client.clientId)),
    def(3, 'CNSCRD', 'Branch Identifier', 'P', 30, 'Optional', 'Branch.code', 'Trimmed', (c) => cleanText(c.input.branch.code)),
    def(4, 'CNSCRD', 'Kendra/Centre Identifier', 'P', 30, 'Optional', 'Branch.code + Center.code', 'Center.code is only unique per branch, so it is qualified as <branch>-<center>', (c) => centreId(c)),
    def(5, 'CNSCRD', 'Group Identifier', 'P', 50, 'Conditional', 'Group via GroupMember (branch/center/group no.)', 'Required unless Loan Category T03', (c) => cleanText(c.input.groupIdentifier)),
    def(6, 'CNSCRD', 'Member Name 1', 'P', 100, 'Mandatory', 'Client.firstName', 'Printable; ≥1 word of ≥2 letters; no digits / Appendix A disallowed chars', (c) => cleanText(c.input.client.firstName)),
    def(7, 'CNSCRD', 'Member Name 2', 'P', 50, 'Optional', 'Client.lastName', 'Trimmed', (c) => cleanText(c.input.client.lastName)),
    def(8, 'CNSCRD', 'Member Name 3', 'P', 50, 'Optional', NO_SOURCE, 'Blank'),
    def(9, 'CNSCRD', 'Old Member Identifier', 'P', 35, 'Optional', NO_SOURCE, 'Blank (ClientIdChangeLog is not part of this export)'),
    def(10, 'CNSCRD', 'Member Birth Date', 'N', 8, 'Mandatory', 'Client.dateOfBirth (IST calendar date)', 'DDMMYYYY; age ≥16 at report date; not after disbursal', (c) => ymdToDdmmyyyy(c.input.client.dobYmd)),
    def(11, 'CNSCRD', 'Member Age', 'N', 3, 'Optional', 'DOB captured instead', 'Blank when DOB is reported'),
    def(12, 'CNSCRD', "Member's age as on date", 'N', 8, 'Optional', 'DOB captured instead', 'Blank when DOB is reported'),
    def(13, 'CNSCRD', 'Member Gender Type', 'A', 1, 'Mandatory', 'Client.gender', 'Mapped to F/M/T; unmapped → record invalid', (c) => mapGender(c.input.client.gender) ?? ''),
    def(14, 'CNSCRD', 'Marital Status Type', 'A/N', 3, 'Optional', 'Client.maritalStatus', 'Mapped to M01-M05; unmapped → blank', (c) => mapMaritalStatus(c.input.client.maritalStatus) ?? ''),
    def(15, 'CNSCRD', "Key Person's name", 'P', 100, 'Optional', 'Client.spouseName else Client.fatherName', 'Spouse preferred, father otherwise', (c) => keyPerson(c)?.name ?? ''),
    def(16, 'CNSCRD', "Key Person's relationship", 'A/N', 3, 'Optional', 'Derived from key-person source', 'K02/K06 spouse (by spouseGender), K01 father', (c) => keyPerson(c)?.rel ?? ''),
    def(17, 'CNSCRD', 'Member relationship Name 1', 'P', 100, 'Optional', 'Client.fatherName', 'Trimmed', (c) => cleanText(c.input.client.fatherName)),
    def(18, 'CNSCRD', 'Member relationship Type 1', 'A/N', 3, 'Optional', 'Constant for fatherName', 'K01', (c) => (cleanText(c.input.client.fatherName) ? 'K01' : '')),
    def(19, 'CNSCRD', 'Member relationship Name 2', 'P', 100, 'Optional', 'Client.spouseName', 'Trimmed', (c) => cleanText(c.input.client.spouseName)),
    def(20, 'CNSCRD', 'Member relationship Type 2', 'A/N', 3, 'Optional', 'Client.spouseGender / member gender', 'K02 husband / K06 wife', (c) => (cleanText(c.input.client.spouseName) ? spouseRelation(c) : '')),
    def(21, 'CNSCRD', 'Member relationship Name 3', 'P', 100, 'Optional', 'Client.motherName', 'Trimmed', (c) => cleanText(c.input.client.motherName)),
    def(22, 'CNSCRD', 'Member relationship Type 3', 'A/N', 3, 'Optional', 'Constant for motherName', 'K03', (c) => (cleanText(c.input.client.motherName) ? 'K03' : '')),
    def(23, 'CNSCRD', 'Member relationship Name 4', 'P', 100, 'Optional', NO_SOURCE, 'Blank'),
    def(24, 'CNSCRD', 'Member relationship Type 4', 'A/N', 3, 'Optional', NO_SOURCE, 'Blank'),
    def(25, 'CNSCRD', 'Nominee Name', 'P', 100, 'Optional', 'Client.nomineeName', 'Emitted only with a mappable relationship', (c) => {
        const name = cleanText(c.input.client.nomineeName);
        if (!name) return '';
        if (!mapRelationship(c.input.client.nomineeRelation, c.input.client.gender)) {
            c.warn(25, 'Nominee Name', name, 'Nominee relationship is missing or not in the UCRF enumeration; nominee left blank', 'Use Father, Husband, Mother, Son, Daughter, Wife, Brother, Sister, … in the client record');
            return '';
        }
        return name;
    }),
    def(26, 'CNSCRD', 'Nominee relationship', 'A/N', 3, 'Optional', 'Client.nomineeRelation', 'Mapped to K-code; "Spouse" → K02 for a female member, K06 for a male member', (c) => (cleanText(c.input.client.nomineeName) ? mapRelationship(c.input.client.nomineeRelation, c.input.client.gender) ?? '' : '')),
    def(27, 'CNSCRD', 'Reserved for Future Use', 'N', 3, 'Optional', RESERVED, 'Blank'),
    def(28, 'CNSCRD', "Voter's ID", 'A/N', 20, 'Conditional', 'Client.votersIdNo', 'Special chars stripped; 8-16 chars, first 2-3 letters', (c) =>
        optionalId(c, 28, "Voter's ID", c.input.client.votersIdNo, alnumUpper, isValidVoterId)),
    def(29, 'CNSCRD', 'UID', 'A/N', 12, 'Conditional', 'Client.otherIdNo (Aadhaar)', '12 digits with valid Verhoeff check digit', (c) =>
        optionalId(c, 29, 'UID', c.input.client.aadhaar, digitsOnly, isValidAadhaar)),
    def(30, 'CNSCRD', 'PAN', 'A/N', 15, 'Conditional', 'Client.pancardNo', '10 chars AAAAA9999A, 4th char P/H', (c) =>
        optionalId(c, 30, 'PAN', c.input.client.pancardNo, alnumUpper, isValidPan)),
    def(31, 'CNSCRD', 'Ration Card', 'A/N', 20, 'Conditional', NO_SOURCE, 'Blank'),
    def(32, 'CNSCRD', 'G-RAM-G', 'P', 35, 'Conditional', NO_SOURCE, 'Blank'),
    def(33, 'CNSCRD', 'CKYC', 'P', 15, 'Conditional', NO_SOURCE, 'Blank'),
    def(34, 'CNSCRD', "Driver's License Number", 'P', 30, 'Conditional', NO_SOURCE, 'Blank'),
    def(35, 'CNSCRD', 'Passport Number', 'P', 10, 'Conditional', NO_SOURCE, 'Blank'),
    def(36, 'CNSCRD', 'Member Other ID 3 Type description', 'A/N', 20, 'Optional', NO_SOURCE, 'Blank'),
    def(37, 'CNSCRD', 'Member Other ID 3', 'A/N', 30, 'Optional', NO_SOURCE, 'Blank'),
    def(38, 'CNSCRD', 'Telephone Number 1 type Indicator', 'A/N', 3, 'Optional', 'Constant when a phone is present', 'P03 (Mobile)', (c) => (phoneOf(c) ? 'P03' : '')),
    def(39, 'CNSCRD', 'Member Telephone Number 1', 'A/N', 15, 'Conditional', 'Client.mobileNumber else Client.phone', 'Digits only, +91/0 prefix stripped; valid Indian mobile', (c) => {
        const p = phoneOf(c);
        if (!p) return '';
        if (isValidIndianPhone(p)) return p;
        c.warn(39, 'Member Telephone Number 1', p, 'Telephone number is not a valid Indian mobile number and was left blank', 'Correct the mobile number in the client record');
        return '';
    }),
    def(40, 'CNSCRD', 'Telephone Number 2 type Indicator', 'A/N', 3, 'Optional', NO_SOURCE, 'Blank'),
    def(41, 'CNSCRD', 'Member Telephone Number 2', 'A/N', 15, 'Conditional', NO_SOURCE, 'Blank'),
    def(42, 'CNSCRD', "Member's Educational Qualification", 'A/N', 3, 'Optional', 'Client.qualification', 'Mapped to Y01-Y05; unmapped → blank', (c) => mapEducation(c.input.client.qualification) ?? ''),
    def(43, 'CNSCRD', 'Reserved for Future Use', 'A/N', 3, 'Optional', RESERVED, 'Blank'),
    def(44, 'CNSCRD', 'Reserved for Future Use', 'N', 2, 'Optional', RESERVED, 'Blank'),
    def(45, 'CNSCRD', 'Bank Account - Bank Name', 'P', 50, 'Optional', 'Client.bankName', 'Blanked when >50 chars', (c) => fit(c, 45, 'Bank Name', cleanText(c.input.client.bankName), 50)),
    def(46, 'CNSCRD', 'Bank Account - Branch Name', 'P', 50, 'Optional', 'Client.ifscCode', 'IFSC preferred by the spec', (c) => fit(c, 46, 'Bank Branch', cleanText(c.input.client.ifscCode), 50)),
    def(47, 'CNSCRD', 'Bank Account - Account Number', 'P', 35, 'Optional', 'Client.bankAcNo', 'Blanked when >35 chars', (c) => fit(c, 47, 'Bank Account Number', cleanText(c.input.client.bankAcNo), 35)),
    def(48, 'CNSCRD', 'Occupation', 'A/N', 3, 'Optional', 'EconomicActivity not mapped', 'Blank — needs an economic-activity → Z01-Z06 mapping to populate'),
    def(49, 'CNSCRD', 'Total Monthly Family Income', 'N', 9, 'Conditional', 'Client.monthlyFamilyIncome', 'Whole rupees; mandatory for disbursals from 01-Apr-2022', (c) => {
        const v = c.input.client.monthlyFamilyIncome;
        return v && v > 0 ? String(Math.trunc(v)) : '';
    }),
    def(50, 'CNSCRD', 'Monthly Family Expenses', 'N', 9, 'Optional', 'Client.monthlyFamilyExpense', 'Whole rupees', (c) => {
        const v = c.input.client.monthlyFamilyExpense;
        return v && v > 0 ? String(Math.trunc(v)) : '';
    }),
    def(51, 'CNSCRD', "Member's Religion", 'A/N', 3, 'Optional', 'Client.religion', 'Mapped to R01-R09; unmapped → blank', (c) => mapReligion(c.input.client.religion) ?? ''),
    def(52, 'CNSCRD', "Member's Caste or Social Strata", 'A/N', 3, 'Optional', 'Client.caste', 'Mapped to V01-V09; unmapped → blank', (c) => mapCaste(c.input.client.caste) ?? ''),
    def(53, 'CNSCRD', "Member's Role", 'A/N', 3, 'Optional', NO_SOURCE, 'Blank'),
    def(54, 'CNSCRD', 'Reserved for Future Use', 'A/N', 1, 'Optional', RESERVED, 'Blank'),
    def(55, 'CNSCRD', "Member's Status", 'A/N', 3, 'Optional', 'Constant — account is reported only after disbursal', 'W01 (Active loanee)', () => 'W01'),

    // ── ADRCRD — Address segment (one segment per member) ──────────────────────────────
    def(56, 'ADRCRD', 'Segment Identifier', 'A/N', 6, 'Mandatory', 'Constant', 'Literal "ADRCRD"', () => 'ADRCRD'),
    def(57, 'ADRCRD', "Member's Permanent Address", 'P', 200, 'Conditional', 'Client.permanentAddress', 'Min 3 chars', (c) => addressValues(c).address),
    def(58, 'ADRCRD', 'State Code (Permanent Address)', 'A', 2, 'Conditional', 'Client.state → Appendix B', 'Resolved by name; unknown → record invalid', (c) => addressValues(c).stateCode),
    def(59, 'ADRCRD', 'Pin Code (Permanent Address)', 'P', 7, 'Conditional', 'Client.pincode', '6 digits; prefix within Appendix C range of the state', (c) => addressValues(c).pin),
    def(60, 'ADRCRD', "Member's Current Address", 'P', 200, 'Conditional', 'Client.permanentAddress', 'Spec: with one address available, report it as the current address too', (c) => addressValues(c).address),
    def(61, 'ADRCRD', 'State Code (Current Address)', 'A', 2, 'Conditional', 'Client.state → Appendix B', 'As field 58', (c) => addressValues(c).stateCode),
    def(62, 'ADRCRD', 'Pin Code (Current Address)', 'P', 7, 'Conditional', 'Client.pincode', 'As field 59', (c) => addressValues(c).pin),
    def(63, 'ADRCRD', 'Email ID', 'A/N', 70, 'Optional', 'Client.email', 'Blanked when it fails the recommended checks', (c) => {
        const e = (c.input.client.email ?? '').trim();
        if (!e) return '';
        if (e.length <= 70 && /^[A-Za-z0-9._-]{2,}@[A-Za-z0-9-]{2,}(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(e)) return e;
        c.warn(63, 'Email ID', e, 'Email ID fails the UCRF quality checks and was left blank');
        return '';
    }),

    // ── ACTCRD — Account segment ───────────────────────────────────────────────────────
    def(64, 'ACTCRD', 'Segment Identifier', 'A/N', 6, 'Mandatory', 'Constant', 'Literal "ACTCRD"', () => 'ACTCRD'),
    def(65, 'ACTCRD', 'Unique Account Reference number', 'P', 35, 'Mandatory', 'Loan.loanNumber', 'Stable across submissions', (c) => cleanText(c.input.loanNumber)),
    def(66, 'ACTCRD', 'Account Number', 'P', 35, 'Mandatory', 'Loan.loanNumber', 'Same as field 65 (no branch split/join tracked)', (c) => cleanText(c.input.loanNumber)),
    def(67, 'ACTCRD', 'Branch Identifier', 'P', 30, 'Optional', 'Branch.code', 'Trimmed', (c) => cleanText(c.input.branch.code)),
    def(68, 'ACTCRD', 'Kendra/Centre Identifier', 'P', 30, 'Optional', 'Branch.code + Center.code', 'As field 4', (c) => centreId(c)),
    def(69, 'ACTCRD', 'Loan Officer originating the loan', 'A/N', 30, 'Optional', NO_SOURCE, 'Blank'),
    def(70, 'ACTCRD', 'Date of Account Information', 'N', 8, 'Mandatory', 'Report date filter', 'DDMMYYYY; equals header Reported Date', (c) => ymdToDdmmyyyy(c.reportYmd)),
    def(71, 'ACTCRD', 'Loan Category', 'A/N', 3, 'Mandatory', 'UcrfInstitutionConfig.loanCategory', 'T01/T02/T03 (JLG layout)', (c) => c.config.loanCategory),
    def(72, 'ACTCRD', 'Group Identifier', 'P', 50, 'Conditional', 'Same as field 5', 'Required unless T03', (c) => cleanText(c.input.groupIdentifier)),
    def(73, 'ACTCRD', 'Loan Cycle-id', 'N', 3, 'Optional', "Ordinal of the client's disbursed loans", 'Blank when the sequence cannot be derived', (c) => (c.input.loanCycle ? String(c.input.loanCycle) : '')),
    def(74, 'ACTCRD', 'Loan Purpose', 'P', 20, 'Optional', 'LoanPurpose.name', 'Blanked when >20 chars (no truncation allowed)', (c) => fit(c, 74, 'Loan Purpose', cleanText(c.input.purposeName), 20)),
    def(75, 'ACTCRD', 'Account Status', 'A/N', 3, 'Mandatory', 'Derived: Loan.disbursementStatus, closure, DPD', 'S04 current / S05 delinquent / S06 written off / S07 closed', (c) => c.state.status),
    def(76, 'ACTCRD', 'Reserved for Future Use', 'N', 8, 'Optional', RESERVED, 'Blank'),
    def(77, 'ACTCRD', 'Sanctioned Date', 'N', 8, 'Optional', NO_SOURCE, 'Blank'),
    def(78, 'ACTCRD', 'Date Opened/Disbursed', 'N', 8, 'Mandatory', 'Loan.disbursedByBMAt (fallback disbursedLevel1At), IST date', 'DDMMYYYY', (c) => ymdToDdmmyyyy(c.input.disbursedYmd)),
    def(79, 'ACTCRD', 'Date Closed (if closed)', 'N', 8, 'Conditional', 'Loan.closedDate', 'Required for S07/S09/S12', (c) => ymdToDdmmyyyy(c.state.closedYmd)),
    def(80, 'ACTCRD', 'Date of last payment', 'N', 8, 'Optional', 'Latest approved, non-reversed REPAYMENT/PRECLOSURE transactionDate ≤ report date', 'Blanked if before disbursal', (c) => {
        const d = c.input.lastPaymentYmd;
        if (!d) return '';
        if (c.input.disbursedYmd && d < c.input.disbursedYmd) {
            c.warn(80, 'Date of last payment', d, 'Last payment is before the disbursal date and was left blank');
            return '';
        }
        return ymdToDdmmyyyy(d);
    }),
    def(81, 'ACTCRD', 'Applied For Amount', 'N', 9, 'Optional', 'Loan.appliedAmount', 'Whole rupees', (c) => (c.input.appliedAmount && c.input.appliedAmount > 0 ? String(Math.trunc(c.input.appliedAmount)) : '')),
    def(82, 'ACTCRD', 'Loan amount Sanctioned', 'N', 9, 'Optional', 'Loan.amount', 'Spec allows replicating disbursed amount', (c) => String(Math.trunc(c.input.amount))),
    def(83, 'ACTCRD', 'Total Amount Disbursed (Rupees)', 'N', 9, 'Mandatory', 'Loan.amount', 'Whole rupees (truncated)', (c) => String(Math.trunc(c.input.amount))),
    def(84, 'ACTCRD', 'Number of Installments', 'N', 3, 'Conditional', 'Count of LoanSchedule rows', 'Original installment count; required for JLG', (c) => (c.state.installments > 0 ? String(c.state.installments) : '')),
    def(85, 'ACTCRD', 'Repayment Frequency', 'A/N', 3, 'Conditional', 'Loan.frequency, else LoanProduct.frequency when the loan has none', 'WEEKLY→F01, FORTNIGHTLY→F02, MONTHLY→F03, …; unmapped → record invalid', (c) => mapRepaymentFrequency(c.input.frequency) ?? ''),
    def(86, 'ACTCRD', 'Minimum Amount Due/Instalment Amount', 'N', 9, 'Conditional', 'First LoanSchedule principalDue + interestDue', 'Whole rupees; >0 for disbursals from 01-Apr-2022', (c) => (c.state.installmentRupees > 0 ? String(c.state.installmentRupees) : '')),
    def(87, 'ACTCRD', 'Current Balance (Rupees)', 'N', 9, 'Mandatory', 'Loan.amount − Σ approved principal (LoanTransactionLine ledger)', 'Whole rupees; 0 for closed/written-off', (c) => String(c.state.outstandingRupees)),
    def(88, 'ACTCRD', 'Amount Overdue (Rupees)', 'N', 9, 'Conditional', 'Σ unpaid principal+interest of schedules due before report date', 'Whole rupees; 0 when DPD is 0', (c) => String(c.state.overdueRupees)),
    def(89, 'ACTCRD', 'DPD (Days past due)', 'A/N', 3, 'Mandatory', 'Max days since the oldest unpaid past-due installment', 'Zero-padded 3 digits, capped at 999', (c) => String(c.state.dpd).padStart(3, '0')),
    def(90, 'ACTCRD', 'Write Off Amount (Rupees)', 'N', 9, 'Conditional', 'WRITEOFF LoanTransaction.amount', 'Only for S06', (c) => (c.state.writeOffRupees !== null ? String(c.state.writeOffRupees) : '')),
    def(91, 'ACTCRD', 'Date - Write - Off (if written - off)', 'N', 8, 'Conditional', 'WRITEOFF LoanTransaction.transactionDate', 'Only for S06', (c) => ymdToDdmmyyyy(c.state.writeOffYmd)),
    def(92, 'ACTCRD', 'Write - off reason (if written off)', 'A/N', 3, 'Optional', 'Loan.closureReason', 'DEAD→X02, WRITEOFF→X09 (untagged)', (c) => c.state.writeOffReason ?? ''),
    def(93, 'ACTCRD', 'Loan Type', 'A/N', 3, 'Optional', 'Constant — all loans are term loans', 'C01', () => 'C01'),
    def(94, 'ACTCRD', 'Old Unique account reference number', 'N', 35, 'Optional', NO_SOURCE, 'Blank'),
    def(95, 'ACTCRD', 'Insurance Indicator', 'A/N', 1, 'Optional', 'InsuranceRecord (loan-linked)', 'Y when a record exists, else blank (absence of a record is not proof of no cover)', (c) => (c.input.insurance ? 'Y' : '')),
    def(96, 'ACTCRD', 'Type of Insurance', 'A/N', 3, 'Optional', 'InsuranceRecord.policyType', 'CREDIT_LIFE→L02, HEALTH→L03, PERSONAL_ACCIDENT/GROUP→L10', (c) => {
        const t = c.input.insurance?.policyType;
        if (!t) return '';
        return { CREDIT_LIFE: 'L02', HEALTH: 'L03', PERSONAL_ACCIDENT: 'L10', GROUP: 'L10' }[t] ?? '';
    }),
    def(97, 'ACTCRD', 'Sum Assured/Coverage', 'N', 9, 'Optional', 'InsuranceRecord.coverageAmount', 'Whole rupees', (c) => (c.input.insurance && c.input.insurance.coverageAmount > 0 ? String(Math.trunc(c.input.insurance.coverageAmount)) : '')),
    def(98, 'ACTCRD', 'Old Account number', 'P', 35, 'Optional', NO_SOURCE, 'Blank'),
    def(99, 'ACTCRD', 'Settlement Amount', 'N', 9, 'Optional', NO_SOURCE, 'Blank (settled statuses S10/S11 are not produced)'),
    def(100, 'ACTCRD', 'Dummy (Reserved for Future Use)', 'A/N', 30, 'Optional', RESERVED, 'Blank'),
];

if (UCRF_FIELDS.length !== 100) {
    throw new Error(`UCRF field table must have 100 entries, has ${UCRF_FIELDS.length}`);
}

export const UCRF_UNMAPPED_NOTES: string[] = [
    'Occupation (field 48): economic activity is not mapped to Z01-Z06 — emitted blank.',
    'Member Name 3, Old Member Identifier, Ration Card, G-RAM-G, CKYC, Driving Licence, Passport, 2nd telephone, Loan Officer, Sanctioned Date, Old account numbers, Settlement Amount: no reliable source — emitted blank.',
    'Loan Category defaults to the value saved in the institution settings (T01/T02/T03) — confirm which applies to your JLG product.',
    'Written-off (S06): write-off amount/date come from the WRITEOFF transaction; reason X09 (untagged) unless the loan was closed as DEAD (X02). Current balance is reported as 0 — confirm with the CIC.',
    'DPD is zero-padded to 3 digits per the specification text (the sample file shows it unpadded).',
    'Appendix B of the PDF has HP/HR and JK/JH descriptions swapped relative to Appendix C; Appendix C pairings are used.',
];

function fit(c: FieldContext, no: number, field: string, value: string, max: number): string {
    if (value.length <= max) return value;
    c.warn(no, field, value, `${field} is longer than ${max} characters (UCRF forbids truncation) and was left blank`);
    return '';
}

/** Render the 100 positional fields for one account. Non-fatal adjustments are reported via `warn`. */
export function buildUcrfFields(ctx: FieldContext): string[] {
    return UCRF_FIELDS.map((f) => (f.build ? f.build(ctx) : ''));
}

export function makeWarn(input: UcrfLoanInput, sink: UcrfValidationIssue[]): FieldContext['warn'] {
    return (fieldNo, field, value, reason, suggestion) => {
        sink.push({
            loanId: input.loanId,
            loanNumber: input.loanNumber,
            memberId: input.client.clientId,
            fieldNo,
            field,
            value: maskForIssue(field, value),
            reason,
            suggestion,
            severity: 'warning',
        });
    };
}

const SENSITIVE = /\buid\b|\bpan\b|phone|telephone|account number|aadhaar|ration|passport|licen|voter/i;
export function maskForIssue(field: string, value: string): string {
    const v = value.length > 40 ? `${value.slice(0, 40)}…` : value;
    if (SENSITIVE.test(field) && v.length > 4) return `${'*'.repeat(v.length - 4)}${v.slice(-4)}`;
    return v;
}

export { UCRF_LAYOUT_VERSION };
