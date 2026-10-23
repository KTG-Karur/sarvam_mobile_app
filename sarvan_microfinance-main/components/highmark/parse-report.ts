// Parses the raw CRIF (SurepassCrif) `reportJson` payload into typed, display-ready
// shapes. Field names below mirror the vendor's CONSUMER BASE(tm) REPORT sections
// (Account Summary, Inquiry Input Information, CRIF HM Score(s), Personal Information
// - Variations, Account Information, Inquiries) so the on-screen Full View and the
// PDF export can share one source of truth.

export interface CrifVariationEntry {
  VALUE: string;
  'REPORTED-DATE': string;
}

interface CrifVariationBlock {
  VARIATION?: CrifVariationEntry | CrifVariationEntry[];
}

export interface CrifLoanDetails {
  'ACCT-NUMBER'?: string;
  'CREDIT-GUARANTOR'?: string;
  'CREDIT-GRANTOR-GROUP'?: string;
  'CREDIT-GRANTOR-TYPE'?: string;
  'ACCT-TYPE'?: string;
  'DATE-REPORTED'?: string;
  'OWNERSHIP-IND'?: string;
  'ACCOUNT-STATUS'?: string;
  'DISBURSED-AMT'?: string;
  'DISBURSED-DT'?: string;
  'LAST-PAYMENT-DATE'?: string;
  'CLOSED-DATE'?: string | null;
  'INSTALLMENT-AMT'?: string;
  'OVERDUE-AMT'?: string;
  'WRITE-OFF-AMT'?: string;
  'PRINCIPAL-WRITE-OFF-AMT'?: string | null;
  'SETTLEMENT-AMT'?: string | null;
  'CURRENT-BAL'?: string;
  'COMBINED-PAYMENT-HISTORY'?: string;
  'REPAYMENT-TENURE'?: string;
  'INTEREST-RATE'?: string;
  'CREDIT-LIMIT'?: string;
  'CASH-LIMIT'?: string;
  'LAST-PAID-AMOUNT'?: string | null;
  DPD?: string;
  [key: string]: unknown;
}

export interface CrifInquiry {
  'MEMBER-NAME'?: string;
  PURPOSE?: string;
  AMOUNT?: string;
  REMARK?: string;
  'INQUIRY-DATE'?: string;
}

export interface CrifReportJson {
  HEADER?: {
    'DATE-OF-REQUEST'?: string;
    'DATE-OF-ISSUE'?: string;
    'REPORT-ID'?: string;
    'BATCH-ID'?: string;
    STATUS?: string;
  };
  'PERSONAL-INFO-VARIATION'?: {
    'NAME-VARIATIONS'?: CrifVariationBlock | string;
    'ADDRESS-VARIATIONS'?: CrifVariationBlock | string;
    'PAN-VARIATIONS'?: CrifVariationBlock | string;
    'DATE-OF-BIRTH-VARIATIONS'?: CrifVariationBlock | string;
    'VOTER-ID-VARIATIONS'?: CrifVariationBlock | string;
    'RATION-CARD-VARIATIONS'?: CrifVariationBlock | string;
    'PHONE-NUMBER-VARIATIONS'?: CrifVariationBlock | string;
    'EMAIL-VARIATIONS'?: CrifVariationBlock | string;
    'UID-VARIATIONS'?: CrifVariationBlock | string;
  };
  'ACCOUNTS-SUMMARY'?: {
    'DERIVED-ATTRIBUTES'?: Record<string, string>;
    'PRIMARY-ACCOUNTS-SUMMARY'?: Record<string, string>;
  };
  'EMPLOYMENT-DETAILS'?: { 'EMPLOYMENT-DETAIL'?: { 'ACCT-TYPE'?: string; 'DATE-REPORTED'?: string; OCCUPATION?: string } };
  RESPONSES?: { RESPONSE?: Array<{ 'LOAN-DETAILS'?: CrifLoanDetails }> };
  'INQUIRY-HISTORY'?: { HISTORY?: CrifInquiry | CrifInquiry[] };
  SCORES?: { SCORE?: { 'SCORE-TYPE'?: string; 'SCORE-VALUE'?: string; 'SCORE-FACTORS'?: string } };
}

function asArray<T>(v: T | T[] | undefined): T[] {
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

export function parseAmount(value: string | null | undefined): number {
  if (!value) return 0;
  const n = parseFloat(value.replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

export function formatInr(value: number): string {
  return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(value);
}

export function getVariations(block: CrifVariationBlock | string | undefined): CrifVariationEntry[] {
  if (!block || typeof block === 'string') return [];
  return asArray(block.VARIATION);
}

export function getLoans(json: CrifReportJson | null | undefined): CrifLoanDetails[] {
  return asArray(json?.RESPONSES?.RESPONSE)
    .map((r) => r['LOAN-DETAILS'])
    .filter((l): l is CrifLoanDetails => !!l);
}

export function getInquiries(json: CrifReportJson | null | undefined): CrifInquiry[] {
  return asArray(json?.['INQUIRY-HISTORY']?.HISTORY);
}

export interface AccountSummaryRow {
  label: string;
  accounts: number;
  active: number;
  overdue: number;
  currentBalance: number;
  disbursedOrHighCredit: number;
}

export function getAccountSummary(json: CrifReportJson | null | undefined): AccountSummaryRow {
  const primary = json?.['ACCOUNTS-SUMMARY']?.['PRIMARY-ACCOUNTS-SUMMARY'];
  if (primary) {
    return {
      label: 'Primary Match',
      accounts: parseAmount(primary['PRIMARY-NUMBER-OF-ACCOUNTS']),
      active: parseAmount(primary['PRIMARY-ACTIVE-NUMBER-OF-ACCOUNTS']),
      overdue: parseAmount(primary['PRIMARY-OVERDUE-NUMBER-OF-ACCOUNTS']),
      currentBalance: parseAmount(primary['PRIMARY-CURRENT-BALANCE']),
      disbursedOrHighCredit: parseAmount(primary['PRIMARY-DISBURSED-AMOUNT']) || getLoans(json).reduce((s, l) => s + parseAmount(l['DISBURSED-AMT']), 0),
    };
  }
  const loans = getLoans(json);
  return {
    label: 'Primary Match',
    accounts: loans.length,
    active: loans.filter((l) => l['ACCOUNT-STATUS'] === 'Active').length,
    overdue: loans.filter((l) => parseAmount(l['OVERDUE-AMT']) > 0).length,
    currentBalance: loans.filter((l) => l['ACCOUNT-STATUS'] === 'Active').reduce((s, l) => s + parseAmount(l['CURRENT-BAL']), 0),
    disbursedOrHighCredit: loans.reduce((s, l) => s + parseAmount(l['DISBURSED-AMT']), 0),
  };
}

export interface ActiveLoanTypeRow {
  type: string;
  accounts: number;
  overdue: number;
  currentBalance: number;
  disbursedOrHighCredit: number;
  instlAmt: number;
  overdueAmt: number;
}

/** "2,339/Monthly/F03" -> 2339. Handles blank/"0/On-demand/On-demand" style values too. */
function parseInstallmentAmount(raw: string | undefined): number {
  if (!raw) return 0;
  return parseAmount(raw.split('/')[0]);
}

const EMPTY_LOAN_TYPE_ROW: Omit<ActiveLoanTypeRow, 'type'> = {
  accounts: 0, overdue: 0, currentBalance: 0, disbursedOrHighCredit: 0, instlAmt: 0, overdueAmt: 0,
};

/** JLG (Joint Liability Group) and other Micro Finance account types vs. every other retail loan type. */
export function isMicrofinanceAcctType(type: string | undefined | null): boolean {
  if (!type) return false;
  return /jlg|micro\s*-?\s*finance|\bmfi\b/i.test(type);
}

function buildLoanTypeRows(loans: CrifLoanDetails[]): { rows: ActiveLoanTypeRow[]; total: ActiveLoanTypeRow } {
  const byType = new Map<string, ActiveLoanTypeRow>();
  for (const l of loans) {
    const type = l['ACCT-TYPE'] || 'Other';
    const row = byType.get(type) ?? { type, ...EMPTY_LOAN_TYPE_ROW };
    row.accounts += 1;
    const overdueAmt = parseAmount(l['OVERDUE-AMT']);
    if (overdueAmt > 0) row.overdue += 1;
    row.overdueAmt += overdueAmt;
    row.currentBalance += parseAmount(l['CURRENT-BAL']);
    row.disbursedOrHighCredit += parseAmount(l['DISBURSED-AMT']);
    row.instlAmt += parseInstallmentAmount(l['INSTALLMENT-AMT']);
    byType.set(type, row);
  }
  const rows = Array.from(byType.values());
  const total = rows.reduce<ActiveLoanTypeRow>(
    (acc, r) => ({
      type: 'Total',
      accounts: acc.accounts + r.accounts,
      overdue: acc.overdue + r.overdue,
      currentBalance: acc.currentBalance + r.currentBalance,
      disbursedOrHighCredit: acc.disbursedOrHighCredit + r.disbursedOrHighCredit,
      instlAmt: acc.instlAmt + r.instlAmt,
      overdueAmt: acc.overdueAmt + r.overdueAmt,
    }),
    { type: 'Total', ...EMPTY_LOAN_TYPE_ROW }
  );
  return { rows, total };
}

export function getActiveAccountsByLoanType(json: CrifReportJson | null | undefined): { rows: ActiveLoanTypeRow[]; total: ActiveLoanTypeRow } {
  const active = getLoans(json).filter((l) => l['ACCOUNT-STATUS'] === 'Active');
  return buildLoanTypeRows(active);
}

/** Same as {@link getActiveAccountsByLoanType} but split into a JLG/Micro Finance table and an "other loan types" table. */
export function getActiveAccountsByLoanTypeSplit(json: CrifReportJson | null | undefined): {
  microfinance: { rows: ActiveLoanTypeRow[]; total: ActiveLoanTypeRow };
  others: { rows: ActiveLoanTypeRow[]; total: ActiveLoanTypeRow };
} {
  const active = getLoans(json).filter((l) => l['ACCOUNT-STATUS'] === 'Active');
  const microfinanceLoans = active.filter((l) => isMicrofinanceAcctType(l['ACCT-TYPE']));
  const otherLoans = active.filter((l) => !isMicrofinanceAcctType(l['ACCT-TYPE']));
  return { microfinance: buildLoanTypeRows(microfinanceLoans), others: buildLoanTypeRows(otherLoans) };
}

/** Groups loans by ACCT-TYPE (stable order: first-seen type order, original order within each type). */
export function sortLoansByType(loans: CrifLoanDetails[]): CrifLoanDetails[] {
  const order: string[] = [];
  const byType = new Map<string, CrifLoanDetails[]>();
  for (const loan of loans) {
    const type = loan['ACCT-TYPE'] || 'Other';
    if (!byType.has(type)) { byType.set(type, []); order.push(type); }
    byType.get(type)!.push(loan);
  }
  return order.flatMap((type) => byType.get(type)!);
}

export type LoanRowStatus = 'active' | 'arrear' | 'closed';

/** "Active" with no overdue amount, "Arrear" is active-but-overdue, everything else (closed/written-off/settled) is "closed". */
export function getLoanStatus(loan: CrifLoanDetails): LoanRowStatus {
  if (loan['ACCOUNT-STATUS'] !== 'Active') return 'closed';
  return parseAmount(loan['OVERDUE-AMT']) > 0 ? 'arrear' : 'active';
}

/** Parses CRIF date strings (DD-MM-YYYY, DD/MM/YYYY or YYYY-MM-DD) into a sortable timestamp; 0 if unparseable. */
function parseCrifDate(raw: string | null | undefined): number {
  if (!raw) return 0;
  const s = raw.trim();
  let m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getTime();
  m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  const parsed = Date.parse(s);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export interface LoanTypeGroup {
  type: string;
  active: CrifLoanDetails[];
  arrear: CrifLoanDetails[];
  closed: CrifLoanDetails[];
}

function byDisbursedDateDesc(a: CrifLoanDetails, b: CrifLoanDetails): number {
  return parseCrifDate(b['DISBURSED-DT']) - parseCrifDate(a['DISBURSED-DT']);
}

/** Groups loans by ACCT-TYPE (first-seen order); within each type: Active, then Arrear (overdue), then Closed — each sorted by disbursed date, most recent first. */
function groupLoansByTypeWithStatusOrder(loans: CrifLoanDetails[]): LoanTypeGroup[] {
  const order: string[] = [];
  const byType = new Map<string, CrifLoanDetails[]>();
  for (const loan of loans) {
    const type = loan['ACCT-TYPE'] || 'Other';
    if (!byType.has(type)) { byType.set(type, []); order.push(type); }
    byType.get(type)!.push(loan);
  }
  return order.map((type) => {
    const groupLoans = byType.get(type)!;
    return {
      type,
      active: groupLoans.filter((l) => getLoanStatus(l) === 'active').sort(byDisbursedDateDesc),
      arrear: groupLoans.filter((l) => getLoanStatus(l) === 'arrear').sort(byDisbursedDateDesc),
      closed: groupLoans.filter((l) => getLoanStatus(l) === 'closed').sort(byDisbursedDateDesc),
    };
  });
}

export interface LoanSections {
  microfinance: LoanTypeGroup[];
  others: LoanTypeGroup[];
}

/** Splits all loans into a JLG/Micro Finance section and an "other loan types" section for the Account Information display. */
export function getLoanSections(json: CrifReportJson | null | undefined): LoanSections {
  const loans = getLoans(json);
  const microfinanceLoans = loans.filter((l) => isMicrofinanceAcctType(l['ACCT-TYPE']));
  const otherLoans = loans.filter((l) => !isMicrofinanceAcctType(l['ACCT-TYPE']));
  return {
    microfinance: groupLoansByTypeWithStatusOrder(microfinanceLoans),
    others: groupLoansByTypeWithStatusOrder(otherLoans),
  };
}

export interface PaymentHistoryCell {
  month: string;
  year: string;
  amount: string;
  classification: string;
}

/** "Jun:2026,000/XXX|May:2026,000/XXX|..." -> parsed cells, most recent first. */
export function parsePaymentHistory(raw: string | undefined): PaymentHistoryCell[] {
  if (!raw) return [];
  return raw
    .split('|')
    .filter(Boolean)
    .map((entry) => {
      const [monthYear, values] = entry.split(',');
      const [month, year] = (monthYear || '').split(':');
      const [amount, classification] = (values || '').split('/');
      return { month: month || '', year: year || '', amount: amount || '', classification: classification || '' };
    });
}

export function getIdEntries(json: CrifReportJson | null | undefined): Array<{ label: string; value: string; reportedOn: string }> {
  const info = json?.['PERSONAL-INFO-VARIATION'];
  const entries: Array<{ label: string; value: string; reportedOn: string }> = [];
  for (const [label, key] of [
    ['Voter ID', 'VOTER-ID-VARIATIONS'],
    ['PAN', 'PAN-VARIATIONS'],
    ['Ration Card', 'RATION-CARD-VARIATIONS'],
    ['UID', 'UID-VARIATIONS'],
  ] as const) {
    const vs = getVariations(info?.[key]);
    if (vs[0]) entries.push({ label, value: vs[0].VALUE, reportedOn: vs[0]['REPORTED-DATE'] });
  }
  return entries;
}
