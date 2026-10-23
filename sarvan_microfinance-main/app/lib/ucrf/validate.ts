import {
    ACCOUNT_STATUSES,
    CLOSED_STATUSES,
    JLG_LOAN_CATEGORIES,
    REPAYMENT_FREQUENCIES,
    STATE_CODES,
    WRITE_OFF_REASONS,
} from './codes';
import { UCRF_FIELDS, maskForIssue } from './field-map';
import { ddmmyyyyToYmd, isValidYmd, PRINTABLE_ASCII } from './format';
import { isValidAadhaar, isValidIndianPhone, isValidPan, isValidPin, isValidVoterId } from './id-validation';
import type { UcrfConfig, UcrfLoanInput, UcrfValidationIssue } from './types';

const MIN_DATE = '1900-01-01';
const INCOME_RULE_FROM = '2022-04-01';
/** Appendix A: characters that must never appear in Member Name 1-3. */
const NAME_DISALLOWED = /[~!#$%^&*=|?+,@]/;

const CHAR_TYPE: Record<string, RegExp> = {
    A: /^[A-Za-z]*$/,
    N: /^[0-9]*$/,
    'A/N': /^[A-Za-z0-9]*$/,
    P: PRINTABLE_ASCII,
};

export function validateRecord(
    input: UcrfLoanInput,
    fields: string[],
    reportYmd: string
): UcrfValidationIssue[] {
    const issues: UcrfValidationIssue[] = [];
    const f = (no: number) => fields[no - 1] ?? '';
    const name = (no: number) => UCRF_FIELDS[no - 1].name;
    const err = (no: number, reason: string, suggestion?: string, severity: 'error' | 'warning' = 'error') =>
        issues.push({
            loanId: input.loanId,
            loanNumber: input.loanNumber,
            memberId: input.client.clientId,
            fieldNo: no,
            field: no === 0 ? 'Record' : name(no),
            value: no === 0 ? '' : maskForIssue(name(no), f(no)),
            reason,
            suggestion,
            severity,
        });
    const dateOk = (no: number): string | null => {
        const v = f(no);
        if (!v) return null;
        const ymd = ddmmyyyyToYmd(v);
        if (!ymd) {
            err(no, `${name(no)} is not a valid DDMMYYYY calendar date`);
            return null;
        }
        if (ymd < MIN_DATE) err(no, `${name(no)} is earlier than 01011900`);
        if (ymd > reportYmd) err(no, `${name(no)} is a future date (after the report date)`);
        return ymd;
    };

    // ── Generic: mandatory / length / character type for every field ───────────────────
    for (const def of UCRF_FIELDS) {
        const v = f(def.no);
        if (def.option === 'Mandatory' && !v) {
            err(def.no, `${def.name} is mandatory`, mandatorySuggestion(def.no));
            continue;
        }
        if (!v) continue;
        // Spec: Optional-field violations are "Reject Field" (the bureau drops that field), not "Reject Record".
        const sev = def.option === 'Optional' ? 'warning' : 'error';
        if (v.length > def.length) err(def.no, `${def.name} is ${v.length} characters; maximum is ${def.length}`, undefined, sev);
        // Email (63) is typed A/N in the spec but legitimately holds @ and .; its format is checked in the builder.
        if (def.no !== 63 && !CHAR_TYPE[def.type].test(v)) err(def.no, `${def.name} contains characters not allowed for type ${def.type}`, undefined, sev);
        if (v.includes('|')) err(def.no, `${def.name} contains the field separator "|"`);
    }

    // ── Member ID / names ──────────────────────────────────────────────────────────────
    if (f(2) && !/[A-Za-z0-9]/.test(f(2))) err(2, 'Member Identifier contains only special characters');
    for (const no of [6, 7]) {
        const v = f(no);
        if (!v) continue;
        if (NAME_DISALLOWED.test(v)) err(no, `${name(no)} contains disallowed characters (Appendix A)`, 'Remove symbols such as ~ ! # $ % ^ & * = | ? + , @');
        if (/[0-9]/.test(v)) err(no, `${name(no)} contains digits (numbers are prohibited in names)`);
        if (/[\\/]/.test(v) && !/\b[A-Za-z][/\\]O\b/i.test(v)) err(no, `${name(no)} contains / or \\ outside S/O, D/O, W/O, H/O`);
        if (/^[SDWH][/\\]O\b/i.test(v)) err(no, `${name(no)} begins with a relationship descriptor`);
    }
    // "Must have at least one word with minimum 2 alphabets (but not just one initial)" — across Name 1-3.
    if (f(6) && !`${f(6)} ${f(7)} ${f(8)}`.split(' ').some((w) => (w.match(/[A-Za-z]/g) ?? []).length >= 2)) {
        err(6, 'Member name needs at least one word with 2 or more letters (not just initials)', 'Enter the full name in the client record');
    }

    // ── DOB ────────────────────────────────────────────────────────────────────────────
    const dob = dateOk(10);
    if (dob) {
        const [y, m, d] = reportYmd.split('-').map(Number);
        const sixteenth = `${String(y - 16).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        if (dob > sixteenth) err(10, 'Member is younger than 16 years at the report date');
        if (input.disbursedYmd && dob > input.disbursedYmd) err(10, 'Birth date is later than the disbursal date');
    }
    if (f(13) && !['F', 'M', 'T'].includes(f(13))) err(13, 'Gender must be F, M or T');
    if (!f(13) && input.client.gender) err(13, `Gender "${input.client.gender}" cannot be mapped to F/M/T`, 'Set the gender to Male / Female / Transgender in the client record');

    // ── Relationship pairs ─────────────────────────────────────────────────────────────
    for (const [n, t] of [[15, 16], [17, 18], [19, 20], [21, 22], [23, 24], [25, 26]] as const) {
        if (f(n) && !f(t)) err(t, `${name(t)} is required when ${name(n)} is reported`);
        if (!f(n) && f(t)) err(n, `${name(n)} is required when ${name(t)} is reported`);
    }

    // ── ID / phone: need at least one valid ID or valid telephone ──────────────────────
    const hasValidId =
        (f(28) && isValidVoterId(f(28))) || (f(29) && isValidAadhaar(f(29))) || (f(30) && isValidPan(f(30))) || !!f(31) || !!f(32) || !!f(33) || !!f(34) || !!f(35);
    const hasValidPhone = !!f(39) && isValidIndianPhone(f(39));
    if (!hasValidId && !hasValidPhone) {
        err(0, 'Neither a valid ID (Voter/UID/PAN/…) nor a valid telephone number is available', 'Capture a valid Aadhaar or mobile number for the member');
    }
    if (f(38) && !f(39)) err(38, 'Telephone type is reported without a number');

    // ── Income rule ────────────────────────────────────────────────────────────────────
    if (input.disbursedYmd && input.disbursedYmd >= INCOME_RULE_FROM && !f(49)) {
        err(49, 'Total Monthly Family Income is mandatory (blank/zero) for disbursals from 01-Apr-2022', 'Enter the monthly family income in the client record');
    }

    // ── Address: permanent or current must be fully correct ────────────────────────────
    const addressOk = (aNo: number, sNo: number, pNo: number, report: boolean) => {
        const a = f(aNo);
        const s = f(sNo);
        const p = f(pNo);
        const problems: Array<[number, string, string?]> = [];
        if (a.length < 3) problems.push([aNo, `${name(aNo)} must be at least 3 characters`, 'Complete the address in the client record']);
        else if (!/[A-Za-z0-9]/.test(a)) problems.push([aNo, `${name(aNo)} contains only special characters`]);
        if (!s) {
            problems.push([sNo, input.client.state ? `State "${input.client.state}" is not a recognised Appendix B state` : 'State is missing', 'Set a valid Indian state on the client']);
        } else if (!STATE_CODES[s]) problems.push([sNo, `State code ${s} is not in Appendix B`]);
        if (!p) problems.push([pNo, 'PIN code is missing', 'Enter a 6-digit PIN code']);
        else {
            const pin = isValidPin(p, STATE_CODES[s] ? s : undefined);
            if (!pin.ok) problems.push([pNo, pin.reason!, 'Check the PIN code and state on the client']);
        }
        if (report) problems.forEach(([n, r, sug]) => err(n, r, sug));
        return problems.length === 0;
    };
    const permOk = addressOk(57, 58, 59, false);
    const curOk = addressOk(60, 61, 62, false);
    if (!permOk && !curOk) {
        addressOk(57, 58, 59, true);
        err(0, 'Neither permanent nor current address (address + state + PIN) is correctly reported');
    }

    // ── Account segment ────────────────────────────────────────────────────────────────
    if (!(JLG_LOAN_CATEGORIES as readonly string[]).includes(f(71))) err(71, 'Loan Category must be T01, T02 or T03 for the JLG + Individual layout');
    if (f(71) !== 'T03' && !f(72)) {
        err(72, 'Group Identifier is required for group loans (all categories except T03)', 'Assign the member to a group');
    }
    if (f(5) !== f(72)) err(72, 'Group Identifier in the member and account segments differ');
    const status = f(75);
    if (status && !(ACCOUNT_STATUSES as readonly string[]).includes(status)) err(75, `Account Status ${status} is not in the enumeration`);

    const disb = dateOk(78);
    const closed = dateOk(79);
    dateOk(70);
    if (disb && closed && disb > closed) err(78, 'Disbursed date is later than the closed date');
    if (!input.disbursedYmd) err(78, 'Disbursal date is not recorded on the loan', 'Disbursed loans must have a disbursal date');
    const lastPay = dateOk(80);
    if (lastPay && disb && lastPay < disb) err(80, 'Date of last payment is before the disbursed date');
    if (dob && lastPay && lastPay < dob) err(80, 'Date of last payment is before the birth date');

    const isClosedStatus = (CLOSED_STATUSES as readonly string[]).includes(status);
    if (isClosedStatus && !f(79)) err(79, 'Date Closed is required for status S07/S09/S12');
    if (['S04', 'S05', 'S08'].includes(status) && f(79)) err(79, 'Date Closed must be blank for status S04/S05/S08');

    const disbursed = Number(f(83));
    if (!f(83) || !(disbursed > 0)) err(83, 'Total Amount Disbursed must be greater than zero');
    const installments = Number(f(84));
    if (!(installments > 0)) err(84, 'Number of Installments must be greater than zero for JLG accounts', 'The loan has no repayment schedule rows');
    if (!(REPAYMENT_FREQUENCIES as readonly string[]).includes(f(85))) {
        err(85, f(85) ? `Repayment Frequency ${f(85)} is not in the enumeration` : `Loan frequency "${input.frequency ?? ''}" cannot be mapped to an F-code`, 'Set the loan frequency to Weekly / Fortnightly / Monthly');
    }
    if (input.disbursedYmd && input.disbursedYmd >= INCOME_RULE_FROM && !(Number(f(86)) > 0)) {
        err(86, 'Instalment Amount must be greater than zero for disbursals from 01-Apr-2022');
    }

    const balance = Number(f(87) || 0);
    const overdue = Number(f(88) || 0);
    const dpd = Number(f(89) || 0);
    if (balance > 0 && isClosedStatus) err(87, 'Current Balance is greater than zero on a closed account');
    if (overdue === 0 && dpd > 0) err(88, 'Amount Overdue is zero while DPD is greater than 0', 'An installment below one rupee overdue cannot be reported; review the schedule');
    if (overdue > 0 && dpd === 0) err(89, 'Amount Overdue is above zero while DPD is 0');
    if (f(79) && overdue > 0 && status !== 'S06') err(88, 'Amount Overdue is above zero on a closed account');
    if (f(79) && dpd > 0 && status !== 'S06') err(89, 'DPD is above zero on a closed account');
    if (status === 'S05' && (dpd === 0 || overdue === 0)) err(75, 'Status S05 (delinquent) requires DPD and Amount Overdue above zero');
    if (!/^\d{3}$/.test(f(89))) err(89, 'DPD must be 3 digits (000-999)');

    const wo = Number(f(90) || 0);
    if (status === 'S06') {
        if (!(wo > 0)) err(90, 'Write Off Amount is required for status S06');
        if (!f(91)) err(91, 'Date Write-Off is required for status S06');
        if (!f(92)) err(92, 'Write-off reason is required for status S06');
    } else if (wo > 0 || f(91) || f(92)) {
        err(90, 'Write-off details are only allowed with status S06');
    }
    if (f(92) && !(WRITE_OFF_REASONS as readonly string[]).includes(f(92))) err(92, 'Write-off reason is not in the enumeration');
    dateOk(91);

    return dedupeIssues(issues);
}

function mandatorySuggestion(no: number): string | undefined {
    switch (no) {
        case 10: return 'Enter the member date of birth in the client record';
        case 13: return 'Set the gender in the client record';
        case 6: return 'Enter the member name';
        case 78: return 'Disbursed loans must carry a disbursal date';
        default: return undefined;
    }
}

function dedupeIssues(list: UcrfValidationIssue[]): UcrfValidationIssue[] {
    const seen = new Set<string>();
    return list.filter((i) => {
        const k = `${i.fieldNo}|${i.reason}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

/** File-level checks (header/trailer inputs). Any error blocks official CDF generation. */
export function validateFileLevel(config: UcrfConfig | null, reportYmd: string, today: string): string[] {
    const errors: string[] = [];
    if (!config) {
        errors.push('Institution settings (Member ID, institution name) have not been saved yet');
        return errors;
    }
    if (!/^[A-Za-z0-9]{1,10}$/.test(config.memberId)) errors.push('Submitting Member ID must be 1-10 alphanumeric characters');
    if (!config.institutionName || config.institutionName.length > 30) errors.push('Submitting Member Name is required (max 30 characters)');
    if (config.submittingBranchId.length > 30) errors.push('Submitting Branch Id must be at most 30 characters');
    if (!isValidYmd(reportYmd)) errors.push('Reported Date is not a valid calendar date');
    else if (reportYmd > today) errors.push('Reported Date cannot be a future date');
    else if (reportYmd < MIN_DATE) errors.push('Reported Date is earlier than 01011900');
    return errors;
}

/** Duplicate detection: identical account reference numbers (field 65) are rejected after the first. */
export function findDuplicateAccountRefs(accountRefsByLoan: Array<{ loanId: string; ref: string }>): Set<string> {
    const seen = new Set<string>();
    const dups = new Set<string>();
    for (const { loanId, ref } of accountRefsByLoan) {
        if (seen.has(ref)) dups.add(loanId);
        else seen.add(ref);
    }
    return dups;
}
