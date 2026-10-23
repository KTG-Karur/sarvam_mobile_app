import type { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx-js-style';
import { drawPdfReportHeader } from '@/app/lib/reports/pdf-report-header';
import { formatInr } from '@/app/lib/reports/profit-loss-export';
import {
    balanceSheetModeLabel,
    buildBalanceSheetLines,
    type BalanceSheetReport,
    type BsLine,
} from '@/app/lib/reports/balance-sheet';

const formatDmy = (ymd: string): string => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : ymd;
};

const indent = (line: BsLine): string => '    '.repeat(line.style === 'ledger' || line.depth > 0 ? line.depth : 0) + line.label;

const AMOUNT_FORMAT = '#,##0.00';
const THIN = { style: 'thin', color: { rgb: '000000' } } as const;

/** Real .xlsx. Amounts are numeric cells (`t:'n'`) with a separate display format; codes stay text. */
export function buildBalanceSheetWorkbook(report: BalanceSheetReport): XLSX.WorkBook {
    const { meta } = report;
    const aoa: (string | number | null)[][] = [
        [meta.companyName.toUpperCase()],
        ['BALANCE SHEET'],
        [`Branch: ${meta.branchLabel}`],
        [`As On Date: ${formatDmy(meta.asOnDate)}`],
        [`Report Mode: ${balanceSheetModeLabel(meta.mode)}`],
        [`Generated: ${meta.generatedAt}`],
        [],
    ];
    const headerIdx = aoa.length;
    aoa.push(['LIABILITIES', 'Account Code', 'Amount', 'ASSETS', 'Account Code', 'Amount']);

    const { left, right } = buildBalanceSheetLines(report);
    const firstBody = aoa.length;
    left.forEach((l, i) => {
        const r = right[i];
        aoa.push([indent(l), l.code, l.amount, indent(r), r.code, r.amount]);
    });
    aoa.push([]);
    const diffRow = aoa.length;
    aoa.push(['Difference (Assets - Liabilities)', '', report.difference]);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    const style = (r: number, c: number, s: Record<string, unknown>) => {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell) cell.s = { ...cell.s, ...s };
    };

    for (let r = firstBody; r < aoa.length; r++) {
        for (const c of [2, 5]) {
            const cell = ws[XLSX.utils.encode_cell({ r, c })];
            if (cell && typeof cell.v === 'number') {
                cell.t = 'n';
                cell.z = AMOUNT_FORMAT;
                style(r, c, { alignment: { horizontal: 'right' } });
            }
        }
    }
    style(0, 0, { font: { bold: true, sz: 14 } });
    style(1, 0, { font: { bold: true, sz: 12 } });
    for (let c = 0; c < 6; c++) {
        style(headerIdx, c, { font: { bold: true }, fill: { fgColor: { rgb: 'E5E7EB' } }, border: { top: THIN, bottom: THIN, left: THIN, right: THIN } });
    }
    const apply = (st: BsLine['style'], r: number, cols: number[]) => {
        if (st === 'group') cols.forEach((c) => style(r, c, { font: { bold: true } }));
        if (st === 'subtotal') cols.forEach((c) => style(r, c, { font: { bold: true, italic: true } }));
        if (st === 'net' || st === 'total') cols.forEach((c) => style(r, c, { font: { bold: true }, border: { top: THIN, bottom: THIN } }));
    };
    left.forEach((l, i) => {
        apply(l.style, firstBody + i, [0, 1, 2]);
        apply(right[i].style, firstBody + i, [3, 4, 5]);
    });
    [0, 1, 2].forEach((c) => style(diffRow, c, { font: { bold: true } }));

    ws['!cols'] = [{ wch: 44 }, { wch: 16 }, { wch: 18 }, { wch: 44 }, { wch: 16 }, { wch: 18 }];
    ws['!merges'] = [0, 1, 2, 3, 4, 5].map((r) => ({ s: { r, c: 0 }, e: { r, c: 5 } }));

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Balance Sheet');
    return wb;
}

export function downloadBalanceSheetExcel(report: BalanceSheetReport, filenameBase: string): void {
    XLSX.writeFile(buildBalanceSheetWorkbook(report), `${filenameBase}.xlsx`);
}

export type PdfHeaderDrawer = (
    doc: jsPDF,
    title: string,
    opts?: { subtitle?: string; fontFamily?: string },
) => Promise<number>;

/** A4 landscape, one six-column table (Liabilities | Assets) so headings repeat on every page. */
export async function drawBalanceSheetReport(
    doc: jsPDF,
    report: BalanceSheetReport,
    reportFont: string,
    drawHeader: PdfHeaderDrawer = drawPdfReportHeader,
): Promise<void> {
    const { meta } = report;
    const subtitle = `${meta.branchLabel}  •  As On ${formatDmy(meta.asOnDate)}  •  ${balanceSheetModeLabel(meta.mode)}`;
    const startY = await drawHeader(doc, 'BALANCE SHEET', { subtitle, fontFamily: reportFont });

    const { left, right } = buildBalanceSheetLines(report);
    const body = left.map((l, i) => {
        const r = right[i];
        return [indent(l), l.code, l.amount === null ? '' : formatInr(l.amount), indent(r), r.code, r.amount === null ? '' : formatInr(r.amount)];
    });

    autoTable(doc, {
        head: [['LIABILITIES', 'Code', 'Amount', 'ASSETS', 'Code', 'Amount']],
        body,
        startY,
        theme: 'grid',
        showHead: 'everyPage',
        headStyles: { font: reportFont, fillColor: '#1346A2', textColor: '#ffffff', fontStyle: 'bold', halign: 'center' },
        styles: { font: reportFont, fontSize: 8, cellPadding: 2, textColor: '#000000', overflow: 'linebreak' },
        columnStyles: {
            0: { cellWidth: 'auto' }, 1: { cellWidth: 24 }, 2: { cellWidth: 28, halign: 'right' },
            3: { cellWidth: 'auto' }, 4: { cellWidth: 24 }, 5: { cellWidth: 28, halign: 'right' },
        },
        didParseCell: (data) => {
            if (data.section !== 'body') return;
            const st = (data.column.index < 3 ? left : right)[data.row.index]?.style;
            if (st && st !== 'ledger' && st !== 'blank') data.cell.styles.fontStyle = 'bold';
            if (st === 'total' || st === 'net') data.cell.styles.fillColor = '#F3F4F6';
        },
    });

    const lastY = () => (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? startY;
    if (!report.isBalanced) {
        doc.setFont(reportFont, 'bold');
        doc.setFontSize(9);
        doc.text(`Out of balance: Assets - Liabilities = ${formatInr(report.difference)}`, 14, lastY() + 7);
    }
    const sigY = Math.min(lastY() + 20, doc.internal.pageSize.getHeight() - 10);
    doc.setFont(reportFont, 'normal');
    doc.setFontSize(9);
    doc.text(`For ${meta.companyName}`, doc.internal.pageSize.getWidth() - 14, sigY, { align: 'right' });
    doc.text('Authorised Signatory', doc.internal.pageSize.getWidth() - 14, sigY + 8, { align: 'right' });
}
