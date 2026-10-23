import { describe, expect, it } from 'vitest';
import { parseLoanCardReportCsv, parseRepaymentReportCsv } from '@/app/lib/services/uploan-loan-history.service';

/**
 * parseReportDate() builds dates via `new Date(y, m-1, d, h, min)` (local time),
 * then callers store `.toISOString()`. On a machine whose local TZ is ahead of
 * UTC (e.g. IST, +5:30), that ISO string's UTC calendar day is one day *behind*
 * the intended IST day — exactly like the app's own real `LoanSchedule.dueDate`
 * rows (e.g. an intended 16-Jul is stored as "...T18:30:00.000Z", i.e. 15-Jul in
 * raw UTC). So assertions here must read the IST calendar day the same way the
 * app itself does (see getKolkataCalendarYmd in app/lib/branch-lock.ts), not a
 * naive `.toISOString().slice(0, 10)`.
 */
function istYmd(iso: string | null | undefined): string | null {
    if (!iso) return null;
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(iso));
}

/** Quotes a CSV field only when it needs it (contains a comma, quote, or newline), RFC4180-style. */
function csvField(v: string): string {
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function csvRow(cells: string[]): string {
    return cells.map(csvField).join(',');
}

function loanCardCsv(scheduleRows: string[][], metaExtra: string[][] = []): string {
    const lines = [
        'Loan Card Reports',
        csvRow(['Client ID', 'M100']),
        csvRow(['Contract Code', 'C100']),
        csvRow(['Loan Officer', 'G Sankar Kumar']),
        csvRow(['Group Name', 'rengan']),
        csvRow(['', '', 'Amount', '30,000']),
        csvRow(['', '', 'Funding Name', 'Acme, Inc']),
        csvRow(['', '', 'No. Of Installments', '40']),
        csvRow(['', '', 'Rate Of Interest', '24']),
        csvRow(['', '', 'Loan Disbursement Date', '10-07-2026']),
        ...metaExtra.map(csvRow),
        csvRow(['Due No', 'Due Date', 'Date Of Payment']),
        ...scheduleRows.map(csvRow),
    ];
    return lines.join('\n');
}

describe('parseLoanCardReportCsv date handling (raw:true fix)', () => {
    it('parses an ambiguous day<=12 due date correctly (the reported bug: 06-08-2026 must stay 6-Aug, not become 8-June)', () => {
        const csv = loanCardCsv([
            ['1', '', '06-08-2026', '750', '250', '', '0', '0', '1000', '29000', '', ''],
        ]);
        const report = parseLoanCardReportCsv(csv);
        expect(report.scheduleRows).toHaveLength(1);
        expect(istYmd(report.scheduleRows[0].dueDate)).toBe('2026-08-06');
    });

    it('parses an unambiguous day>12 due date correctly (must not regress)', () => {
        const csv = loanCardCsv([
            ['1', '', '25-12-2026', '750', '250', '', '0', '0', '1000', '29000', '', ''],
        ]);
        const report = parseLoanCardReportCsv(csv);
        expect(istYmd(report.scheduleRows[0].dueDate)).toBe('2026-12-25');
    });

    it('parses a leap-year Feb 29 date correctly', () => {
        const csv = loanCardCsv([
            ['1', '', '29-02-2024', '750', '250', '', '0', '0', '1000', '29000', '', ''],
        ]);
        const report = parseLoanCardReportCsv(csv);
        expect(istYmd(report.scheduleRows[0].dueDate)).toBe('2024-02-29');
    });

    it('parses a received-date with an embedded AM time correctly', () => {
        const csv = loanCardCsv([
            ['1', '', '06-08-2026', '750', '250', '', '0', '0', '1000', '29000', '16-07-2026 07:25 AM', '1000'],
        ]);
        const report = parseLoanCardReportCsv(csv);
        const received = new Date(report.scheduleRows[0].receivedDate!);
        expect(istYmd(report.scheduleRows[0].receivedDate)).toBe('2026-07-16');
        expect(received.getHours()).toBe(7);
        expect(received.getMinutes()).toBe(25);
    });

    it('parses a received-date with an embedded PM time correctly', () => {
        const csv = loanCardCsv([
            ['1', '', '06-08-2026', '750', '250', '', '0', '0', '1000', '29000', '16-07-2026 03:25 PM', '1000'],
        ]);
        const report = parseLoanCardReportCsv(csv);
        const received = new Date(report.scheduleRows[0].receivedDate!);
        expect(received.getHours()).toBe(15);
        expect(received.getMinutes()).toBe(25);
    });

    it('parses the ambiguous disbursement date correctly too', () => {
        const csv = loanCardCsv([
            ['1', '', '06-08-2026', '750', '250', '', '0', '0', '1000', '29000', '', ''],
        ]);
        const report = parseLoanCardReportCsv(csv);
        expect(istYmd(report.disbursementDate)).toBe('2026-07-10');
    });

    it('leaves a blank received date as null', () => {
        const csv = loanCardCsv([
            ['1', '', '06-08-2026', '750', '250', '', '0', '0', '1000', '29000', '', ''],
        ]);
        const report = parseLoanCardReportCsv(csv);
        expect(report.scheduleRows[0].receivedDate).toBeNull();
    });
});

describe('parseLoanCardReportCsv CSV-quoting/number regressions (raw:true must not break these)', () => {
    it('still parses a quoted comma-containing funder name', () => {
        const csv = loanCardCsv([
            ['1', '', '06-08-2026', '750', '250', '', '0', '0', '1000', '29000', '', ''],
        ]);
        const report = parseLoanCardReportCsv(csv);
        expect(report.funderName).toBe('Acme, Inc');
    });

    it('still parses a thousands-separated amount', () => {
        const csv = loanCardCsv([
            ['1', '', '06-08-2026', '750', '250', '', '0', '0', '1000', '29000', '', ''],
        ]);
        const report = parseLoanCardReportCsv(csv);
        expect(report.amount).toBe(30000);
    });

    it('still parses a quoted multi-line label correctly via normLabel', () => {
        const csv = loanCardCsv(
            [['1', '', '06-08-2026', '750', '250', '', '0', '0', '1000', '29000', '', '']],
            [['Loan\nOfficer', 'Someone Else']],
        );
        // normLabel() collapses the embedded newline, so this quoted "Loan\nOfficer" row
        // matches the same `label0 === 'loan officer'` check as the plain row above it and
        // (being later) overwrites officerName — proving the multi-line quoted field survived
        // csvToRows() intact under raw:true, not just that quoting/commas still work.
        const report = parseLoanCardReportCsv(csv);
        expect(report.officerName).toBe('Someone Else');
        expect(istYmd(report.scheduleRows[0].dueDate)).toBe('2026-08-06');
    });
});

describe('parseRepaymentReportCsv date handling (raw:true fix)', () => {
    function repaymentCsv(eventRows: string[][]): string {
        const lines = [
            'Repayment Report',
            csvRow(['', 'M100: John Doe']),
            csvRow(['Due No', 'Due Date', 'Due Amount', 'Transaction Date', 'Transaction Type']),
            ...eventRows.map(csvRow),
        ];
        return lines.join('\n');
    }

    it('parses an ambiguous day<=12 due date and an AM/PM transaction date correctly', () => {
        const csv = repaymentCsv([
            [
                '1', '06-08-2026', '1,000', '16-07-2026 07:25 AM', 'REPAYMENT',
                '1000', '750', '250', '29000', '100', '16-07-2026', '100', '16-07-2026', '0',
            ],
        ]);
        const report = parseRepaymentReportCsv(csv);
        expect(report.memberId).toBe('M100');
        expect(report.clientName).toBe('John Doe');
        expect(report.events).toHaveLength(1);
        expect(istYmd(report.events[0].dueDate)).toBe('2026-08-06');
        expect(report.events[0].dueAmount).toBe(1000);
        const txnDate = new Date(report.events[0].transactionDate);
        expect(istYmd(report.events[0].transactionDate)).toBe('2026-07-16');
        expect(txnDate.getHours()).toBe(7);
        expect(txnDate.getMinutes()).toBe(25);
    });

    it('skips the blank sub-header row (no transaction type) without throwing', () => {
        const csv = repaymentCsv([
            ['', '', '', '', ''],
            [
                '1', '06-08-2026', '1,000', '16-07-2026 07:25 AM', 'REPAYMENT',
                '1000', '750', '250', '29000', '100', '16-07-2026', '100', '16-07-2026', '0',
            ],
        ]);
        const report = parseRepaymentReportCsv(csv);
        expect(report.events).toHaveLength(1);
    });
});
