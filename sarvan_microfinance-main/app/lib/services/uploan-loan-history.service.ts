import * as XLSX from 'xlsx';

/**
 * Parsers for the two per-loan legacy reports that accompany a upload member
 * Excel: the Loan Card Report (exact per-installment schedule + received
 * amounts) and the Repayment Report (real event-by-event transaction ledger,
 * including Wallet Advance/Pay — the legacy system's name for what Sarvan
 * calls Loan Advance / savingsPaid).
 *
 * Runs client-side only — the parsed result travels to the server as plain
 * JSON (alongside `rows`/`centerOverrides`), so every date field here is an
 * ISO string, not a Date instance, to avoid a lie-by-omission across the
 * network boundary. Convert with `new Date(x)` at the point of use.
 */

export interface LoanCardScheduleRow {
    /** Client-only stable key for editable grids (add/delete rows) — never persisted;
     *  Zod strips it server-side and the schedule's real identity is `installmentNo`. */
    rowId?: string;
    installmentNo: number;
    dueDate: string;
    principalDue: number;
    interestDue: number;
    savingsDue: number;
    feesDue: number;
    totalDue: number;
    outstandingBalance: number;
    receivedDate: string | null;
    receivedAmount: number | null;
}

export interface ParsedLoanCardReport {
    memberId: string;
    contractCode: string;
    officerName: string;
    groupName: string;
    amount: number;
    funderName: string;
    installments: number;
    interestRate: number;
    disbursementDate: string | null;
    scheduleRows: LoanCardScheduleRow[];
}

export interface RepaymentEvent {
    /** Client-only stable key for editable grids (add/delete rows) — never persisted; Zod strips it server-side. */
    rowId?: string;
    dueNo: string;
    dueDate: string | null;
    dueAmount: number;
    transactionDate: string;
    transactionType: string;
    amount: number;
    principalAmount: number;
    interestAmount: number;
    loanBalance: number;
    walletAdvanceAmount: number;
    walletAdvanceDate: string | null;
    walletPayAmount: number;
    walletPayDate: string | null;
    walletBalance: number;
}

export interface ParsedRepaymentReport {
    memberId: string;
    clientName: string;
    events: RepaymentEvent[];
}

export type LoanHistoryByMemberId = Record<
    string,
    { loanCard?: ParsedLoanCardReport; repayment?: ParsedRepaymentReport }
>;

const MONTHS: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function parseReportDate(val: unknown): Date | null {
    const str = String(val ?? '').trim();
    if (!str || str === '-') return null;

    // DD-MM-YYYY, optionally with a trailing "HH:MM AM/PM" time
    // Built with Date.UTC (not `new Date(y, m-1, d, ...)`) so the later `.toISOString()` call
    // reflects the calendar date exactly as written — a local-time construction in an
    // IST (UTC+5:30) environment gets shifted back to 18:30Z the PREVIOUS day, silently
    // losing a day off every due/received date.
    const dmyTime = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM))?$/i);
    if (dmyTime) {
        const [, d, m, y, h, min, ampm] = dmyTime;
        let hour = h ? parseInt(h, 10) : 0;
        if (ampm) {
            if (ampm.toUpperCase() === 'PM' && hour !== 12) hour += 12;
            if (ampm.toUpperCase() === 'AM' && hour === 12) hour = 0;
        }
        const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d), hour, min ? parseInt(min, 10) : 0));
        return isNaN(date.getTime()) ? null : date;
    }

    // DD-Mon-YYYY (e.g. "05-Jun-2026")
    const dMonY = str.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
    if (dMonY) {
        const [, d, mon, y] = dMonY;
        const monthIdx = MONTHS[mon.toLowerCase()];
        if (monthIdx !== undefined) {
            const date = new Date(Date.UTC(Number(y), monthIdx, Number(d)));
            return isNaN(date.getTime()) ? null : date;
        }
    }

    const generic = new Date(str);
    return isNaN(generic.getTime()) ? null : generic;
}

/** Exported for reuse by uploan-branch-repayment.service.ts — same legacy DD-MM-YYYY
 *  date format appears in both report families. */
export function toIso(val: unknown): string | null {
    const d = parseReportDate(val);
    return d ? d.toISOString() : null;
}

/** Exported for reuse by uploan-branch-repayment.service.ts. */
export function toNum(val: unknown): number {
    const str = String(val ?? '').trim().replace(/,/g, '');
    if (!str || str === '-') return 0;
    const n = Number(str);
    return Number.isFinite(n) ? n : 0;
}

function toNumOrNull(val: unknown): number | null {
    const str = String(val ?? '').trim().replace(/,/g, '');
    if (!str || str === '-') return null;
    const n = Number(str);
    return Number.isFinite(n) ? n : null;
}

function cell(row: string[] | undefined, idx: number): string {
    return row?.[idx] !== undefined ? String(row[idx]).trim() : '';
}

/** Lowercase, strip all colons, collapse whitespace (handles embedded newlines in report labels). */
function normLabel(s: string): string {
    return s.toLowerCase().replace(/:/g, '').replace(/\s+/g, ' ').trim();
}

function csvToRows(csvText: string): string[][] {
    // raw:true on read() (not to be confused with sheet_to_json's own `raw` option below)
    // stops SheetJS from auto-detecting date-like cells and reformatting them — without it,
    // an ambiguous DD-MM-YYYY value like "04-08-2026" (day <= 12, so also a valid month) gets
    // silently reformatted to US "4/8/26" order before parseReportDate ever sees it, swapping
    // day and month. Unambiguous values (day > 12) were passing through untouched, which is
    // what made the corruption look intermittent rather than a total parse failure.
    const workbook = XLSX.read(csvText, { type: 'string', raw: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' }) as string[][];
}

/** Sniffs which report a raw CSV/text blob is, by content rather than filename (filenames like "loanCardReport (2).csv" are not reliable join keys). */
export function sniffReportType(csvText: string): 'loanCard' | 'repayment' | 'unknown' {
    const head = csvText.slice(0, 500);
    if (/Loan Card Reports?/i.test(head)) return 'loanCard';
    if (/Repayment Report/i.test(head)) return 'repayment';
    return 'unknown';
}

export function parseLoanCardReportCsv(csvText: string): ParsedLoanCardReport {
    const rows = csvToRows(csvText);

    let memberId = '';
    let contractCode = '';
    let officerName = '';
    let groupName = '';
    let amount = 0;
    let funderName = '';
    let installments = 0;
    let interestRate = 0;
    let disbursementDate: string | null = null;
    let scheduleHeaderIdx = -1;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const label0 = normLabel(cell(row, 0));
        const label2 = normLabel(cell(row, 2));

        if (label0 === 'client id') memberId = cell(row, 1);
        if (label2 === 'amount') amount = toNum(cell(row, 3));
        if (label2 === 'funding name') funderName = cell(row, 3);
        if (label0 === 'contract code') contractCode = cell(row, 1);
        if (label2 === 'no. of installments') installments = toNum(cell(row, 3));
        if (label0 === 'loan officer') officerName = cell(row, 1);
        if (label2 === 'rate of interest') interestRate = toNum(cell(row, 3));
        if (label0 === 'group name') groupName = cell(row, 1);
        if (label2.startsWith('loan disbursement')) disbursementDate = toIso(cell(row, 3));

        if (label0 === 'due no') {
            scheduleHeaderIdx = i;
            break;
        }
    }

    const scheduleRows: LoanCardScheduleRow[] = [];
    for (let i = scheduleHeaderIdx + 1; scheduleHeaderIdx >= 0 && i < rows.length; i++) {
        const row = rows[i];
        const installmentNo = parseInt(cell(row, 0), 10);
        if (!Number.isFinite(installmentNo)) continue;

        scheduleRows.push({
            installmentNo,
            dueDate: toIso(cell(row, 2)) ?? new Date().toISOString(),
            principalDue: toNum(cell(row, 3)),
            interestDue: toNum(cell(row, 4)),
            savingsDue: toNum(cell(row, 6)),
            feesDue: toNum(cell(row, 7)),
            totalDue: toNum(cell(row, 8)),
            outstandingBalance: toNum(cell(row, 9)),
            receivedDate: toIso(cell(row, 10)),
            receivedAmount: toNumOrNull(cell(row, 11)),
        });
    }

    return {
        memberId,
        contractCode,
        officerName,
        groupName,
        amount,
        funderName,
        installments,
        interestRate,
        disbursementDate,
        scheduleRows,
    };
}

export function parseRepaymentReportCsv(csvText: string): ParsedRepaymentReport {
    const rows = csvToRows(csvText);

    let memberId = '';
    let clientName = '';
    let headerIdx = -1;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!memberId) {
            const idMatch = cell(row, 1).match(/^([\w-]+)\s*:\s*(.+)$/);
            if (idMatch) {
                memberId = idMatch[1];
                clientName = idMatch[2].trim();
            }
        }
        if (normLabel(cell(row, 0)) === 'due no') {
            headerIdx = i;
            break;
        }
    }

    const events: RepaymentEvent[] = [];
    for (let i = headerIdx + 1; headerIdx >= 0 && i < rows.length; i++) {
        const row = rows[i];
        const transactionType = cell(row, 4);
        if (!transactionType) continue; // skips the blank "Principal/Interest" sub-header row and trailing blanks

        events.push({
            dueNo: cell(row, 0),
            dueDate: toIso(cell(row, 1)),
            dueAmount: toNum(cell(row, 2)),
            transactionDate: toIso(cell(row, 3)) ?? new Date().toISOString(),
            transactionType,
            amount: toNum(cell(row, 5)),
            principalAmount: toNum(cell(row, 6)),
            interestAmount: toNum(cell(row, 7)),
            loanBalance: toNum(cell(row, 8)),
            walletAdvanceAmount: toNum(cell(row, 9)),
            walletAdvanceDate: toIso(cell(row, 10)),
            walletPayAmount: toNum(cell(row, 11)),
            walletPayDate: toIso(cell(row, 12)),
            walletBalance: toNum(cell(row, 13)),
        });
    }

    return { memberId, clientName, events };
}
