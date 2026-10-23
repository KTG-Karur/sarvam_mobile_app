import type { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx-js-style';
import { drawPdfReportHeader } from '@/app/lib/reports/pdf-report-header';
import type { ProfitLossReport, ProfitLossSection } from '@/app/lib/reports/profit-loss';

/** Display formatting only (screen + PDF). Excel/CSV always carry raw numbers. */
export const formatInr = (n: number): string =>
    n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatDmy = (ymd: string): string => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : ymd;
};

export const profitLossModeLabel = (r: ProfitLossReport): string =>
    r.meta.mode === 'AS_ON' ? 'As On Date' : 'From Date - To Date';

/** "As On 31/10/2026 (FY from 01/04/2026)" or "01/04/2026 to 31/10/2026". */
export const profitLossPeriodLabel = (r: ProfitLossReport): string =>
    r.meta.mode === 'AS_ON'
        ? `As On ${formatDmy(r.meta.toDate)} (financial year from ${formatDmy(r.meta.fromDate)})`
        : `${formatDmy(r.meta.fromDate)} to ${formatDmy(r.meta.toDate)}`;

export type PlLineStyle = 'group' | 'account' | 'subtotal' | 'net' | 'total' | 'blank';
export type PlLine = { label: string; code: string; amount: number | null; style: PlLineStyle };

function sectionLines(section: ProfitLossSection): PlLine[] {
    const lines: PlLine[] = [];
    for (const g of section.groups) {
        if (g.groupName) lines.push({ label: g.groupName, code: '', amount: null, style: 'group' });
        for (const a of g.accounts) {
            lines.push({ label: a.accountName, code: a.accountCode, amount: a.amount, style: 'account' });
        }
        if (g.groupName) lines.push({ label: `Total ${g.groupName}`, code: '', amount: g.total, style: 'subtotal' });
    }
    return lines;
}

const BLANK: PlLine = { label: '', code: '', amount: null, style: 'blank' };

/**
 * Tally-style side-by-side layout: Expenses (+ Net Profit) on the left, Income (+ Net Loss)
 * on the right, padded to equal length, ending with a matching grand-total row. One shape
 * feeds the screen, PDF and Excel so they cannot drift apart.
 */
export function buildSideBySideLines(report: ProfitLossReport): { left: PlLine[]; right: PlLine[] } {
    const left = sectionLines(report.expenses);
    const right = sectionLines(report.income);
    const len = Math.max(left.length, right.length);
    while (left.length < len) left.push(BLANK);
    while (right.length < len) right.push(BLANK);

    // Net result lands on the side that balances the statement.
    left.push(report.netProfit > 0 ? { label: 'Net Profit', code: '', amount: report.netProfit, style: 'net' } : BLANK);
    right.push(report.netLoss > 0 ? { label: 'Net Loss', code: '', amount: report.netLoss, style: 'net' } : BLANK);

    left.push({ label: 'Total', code: '', amount: report.expenseSideTotal, style: 'total' });
    right.push({ label: 'Total', code: '', amount: report.incomeSideTotal, style: 'total' });
    return { left, right };
}

/* ───────────────────────────── Excel ───────────────────────────── */

const AMOUNT_FORMAT = '#,##0.00';
const THIN = { style: 'thin', color: { rgb: '000000' } } as const;

/**
 * Real .xlsx workbook. Amount cells are numeric (`t: 'n'`) with a display format in `z`;
 * account codes stay text. Returned (not written) so tests can inspect cell types.
 */
export function buildProfitLossWorkbook(report: ProfitLossReport): XLSX.WorkBook {
    const { meta } = report;
    const aoa: (string | number | null)[][] = [
        [meta.companyName.toUpperCase()],
        ['PROFIT & LOSS'],
        [`Branch: ${meta.branchLabel}`],
        [`Report Mode: ${profitLossModeLabel(report)}`],
        [`Period: ${profitLossPeriodLabel(report)}`],
        [`Generated: ${meta.generatedAt}`],
        [],
    ];
    const headerRowIdx = aoa.length;
    aoa.push(['EXPENSES', 'Account Code', 'Amount', 'INCOME', 'Account Code', 'Amount']);

    const { left, right } = buildSideBySideLines(report);
    const firstBodyIdx = aoa.length;
    left.forEach((l, i) => {
        const r = right[i];
        aoa.push([l.label, l.code, l.amount, r.label, r.code, r.amount]);
    });
    const styles = left.map((l, i) => [l.style, right[i].style] as const);

    aoa.push([]);
    const summaryStart = aoa.length;
    aoa.push(['Total Expenses', '', report.totalExpenses]);
    aoa.push(['Total Income', '', report.totalIncome]);
    aoa.push([report.netLoss > 0 ? 'Net Loss' : 'Net Profit', '', report.netLoss > 0 ? report.netLoss : report.netProfit]);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const amountCols = [2, 5];

    const setStyle = (r: number, c: number, s: Record<string, unknown>) => {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell) cell.s = { ...cell.s, ...s };
    };

    // Number cells: force numeric type + number format (aoa_to_sheet already infers 'n').
    for (let r = firstBodyIdx; r < aoa.length; r++) {
        for (const c of amountCols.concat(r >= summaryStart ? [2] : [])) {
            const cell = ws[XLSX.utils.encode_cell({ r, c })];
            if (cell && typeof cell.v === 'number') {
                cell.t = 'n';
                cell.z = AMOUNT_FORMAT;
                setStyle(r, c, { alignment: { horizontal: 'right' } });
            }
        }
    }

    setStyle(0, 0, { font: { bold: true, sz: 14 } });
    setStyle(1, 0, { font: { bold: true, sz: 12 } });
    for (let c = 0; c < 6; c++) {
        setStyle(headerRowIdx, c, { font: { bold: true }, border: { top: THIN, bottom: THIN, left: THIN, right: THIN }, fill: { fgColor: { rgb: 'E5E7EB' } } });
    }
    styles.forEach(([ls, rs], i) => {
        const r = firstBodyIdx + i;
        const apply = (style: PlLineStyle, cols: number[]) => {
            if (style === 'group') cols.forEach((c) => setStyle(r, c, { font: { bold: true } }));
            if (style === 'subtotal') cols.forEach((c) => setStyle(r, c, { font: { bold: true, italic: true } }));
            if (style === 'net' || style === 'total') {
                cols.forEach((c) => setStyle(r, c, { font: { bold: true }, border: { top: THIN, bottom: THIN } }));
            }
        };
        apply(ls, [0, 1, 2]);
        apply(rs, [3, 4, 5]);
    });
    for (let r = summaryStart; r < aoa.length; r++) {
        for (const c of [0, 1, 2]) setStyle(r, c, { font: { bold: true } });
    }

    ws['!cols'] = [{ wch: 38 }, { wch: 14 }, { wch: 18 }, { wch: 38 }, { wch: 14 }, { wch: 18 }];
    ws['!merges'] = [0, 1, 2, 3, 4, 5].map((r) => ({ s: { r, c: 0 }, e: { r, c: 5 } }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Profit & Loss');
    return wb;
}

export function downloadProfitLossExcel(report: ProfitLossReport, filenameBase: string): void {
    XLSX.writeFile(buildProfitLossWorkbook(report), `${filenameBase}.xlsx`);
}

/* ────────────────────────────── CSV ────────────────────────────── */

// Text cells starting with these are interpreted as formulas by spreadsheet apps.
const FORMULA_LEAD = /^[=+@]/;

function csvText(value: string): string {
    const safe = FORMULA_LEAD.test(value) ? `'${value}` : value;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Plain numeric field: no currency symbol, no thousands separator, never quoted. */
const csvAmount = (n: number): string => n.toFixed(2);

/**
 * Long-format CSV (one account per row) — easier to filter/pivot than a side-by-side
 * layout. Leading metadata rows carry company, branch, mode and dates.
 */
export function buildProfitLossCsv(report: ProfitLossReport): string {
    const { meta } = report;
    const lines: string[] = [];
    const metaRow = (k: string, v: string) => lines.push(`${csvText(k)},${csvText(v)}`);
    metaRow('Company', meta.companyName.toUpperCase());
    metaRow('Report', 'PROFIT & LOSS');
    metaRow('Branch', meta.branchLabel);
    metaRow('Report Mode', profitLossModeLabel(report));
    metaRow('From Date', meta.fromDate);
    metaRow('To Date', meta.toDate);
    metaRow('Generated', meta.generatedAt);
    lines.push('');
    lines.push(['Section', 'Group', 'Account Name', 'Account Code', 'Amount'].join(','));

    const emit = (sectionName: string, section: ProfitLossSection) => {
        for (const g of section.groups) {
            for (const a of g.accounts) {
                lines.push([csvText(sectionName), csvText(g.groupName), csvText(a.accountName), csvText(a.accountCode), csvAmount(a.amount)].join(','));
            }
        }
    };
    emit('Expenses', report.expenses);
    emit('Income', report.income);

    const total = (label: string, amount: number) => lines.push([csvText('Summary'), '', csvText(label), '', csvAmount(amount)].join(','));
    total('Total Expenses', report.totalExpenses);
    total('Total Income', report.totalIncome);
    total('Net Profit', report.netProfit);
    total('Net Loss', report.netLoss);
    return lines.join('\r\n');
}

export function downloadProfitLossCsv(report: ProfitLossReport, filenameBase: string): void {
    const blob = new Blob(['﻿' + buildProfitLossCsv(report)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${filenameBase}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

/* ────────────────────────────── PDF ────────────────────────────── */

export type PdfHeaderDrawer = (
    doc: jsPDF,
    title: string,
    opts?: { subtitle?: string; fontFamily?: string },
) => Promise<number>;

/**
 * A4 landscape, one six-column table (Expenses | Income zipped row by row) so the heading
 * repeats on every page and long lists never overlap.
 */
export async function drawProfitLossReport(
    doc: jsPDF,
    report: ProfitLossReport,
    reportFont: string,
    drawHeader: PdfHeaderDrawer = drawPdfReportHeader,
): Promise<void> {
    const subtitle = `${report.meta.branchLabel}  •  ${profitLossModeLabel(report)}  •  ${profitLossPeriodLabel(report)}`;
    const startY = await drawHeader(doc, 'PROFIT & LOSS', { subtitle, fontFamily: reportFont });

    const { left, right } = buildSideBySideLines(report);
    const body = left.map((l, i) => {
        const r = right[i];
        return [
            l.label, l.code, l.amount === null ? '' : formatInr(l.amount),
            r.label, r.code, r.amount === null ? '' : formatInr(r.amount),
        ];
    });

    autoTable(doc, {
        head: [['EXPENSES', 'Code', 'Amount', 'INCOME', 'Code', 'Amount']],
        body,
        startY,
        theme: 'grid',
        showHead: 'everyPage',
        headStyles: { font: reportFont, fillColor: '#1346A2', textColor: '#ffffff', fontStyle: 'bold', halign: 'center' },
        styles: { font: reportFont, fontSize: 8, cellPadding: 2, textColor: '#000000', overflow: 'linebreak' },
        columnStyles: {
            0: { cellWidth: 'auto' }, 1: { cellWidth: 22 }, 2: { cellWidth: 28, halign: 'right' },
            3: { cellWidth: 'auto' }, 4: { cellWidth: 22 }, 5: { cellWidth: 28, halign: 'right' },
        },
        didParseCell: (data) => {
            if (data.section !== 'body') return;
            const style = data.column.index < 3 ? left[data.row.index]?.style : right[data.row.index]?.style;
            if (style && style !== 'account' && style !== 'blank') data.cell.styles.fontStyle = 'bold';
            if (style === 'total' || style === 'net') data.cell.styles.fillColor = '#F3F4F6';
        },
    });

    const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? startY;
    const summary = [
        ['Total Expenses', formatInr(report.totalExpenses)],
        ['Total Income', formatInr(report.totalIncome)],
        [report.netLoss > 0 ? 'Net Loss' : 'Net Profit', formatInr(report.netLoss > 0 ? report.netLoss : report.netProfit)],
    ];
    autoTable(doc, {
        body: summary,
        startY: finalY + 6,
        theme: 'grid',
        tableWidth: 90,
        styles: { font: reportFont, fontSize: 9, cellPadding: 2, textColor: '#000000', fontStyle: 'bold' },
        columnStyles: { 1: { halign: 'right' } },
    });

    const sigY = Math.min(
        ((doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? finalY) + 18,
        doc.internal.pageSize.getHeight() - 10,
    );
    doc.setFont(reportFont, 'normal');
    doc.setFontSize(9);
    doc.text(`For ${report.meta.companyName}`, doc.internal.pageSize.getWidth() - 14, sigY, { align: 'right' });
    doc.text('Authorised Signatory', doc.internal.pageSize.getWidth() - 14, sigY + 8, { align: 'right' });
}
