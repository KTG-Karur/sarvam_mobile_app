import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { getActiveBrandNames } from '@/app/lib/brand-server';
import { drawPdfReportHeaderServer } from '@/app/lib/reports/pdf-report-header-server';
import { ensureReportFontServer } from '@/app/lib/reports/pdf-fonts-server';
import { getDocBrandPrimaryRgb } from '@/app/lib/reports/pdf-brand-color';
import { formatReportAmount } from '@/app/lib/utils/format-amount';

export interface SalaryLetterComponent {
    name: string;
    monthlyAmount: number;
}

export interface SalaryLetterData {
    employeeName: string;
    employeeCode: string;
    designation: string;
    department: string;
    branchName: string;
    issueDate: string;
    components: SalaryLetterComponent[];
}

const fmt = (v: number) => formatReportAmount(v);

/**
 * Salary Letter — a CTC/offer-style single letter (annual structure breakdown),
 * distinct from payslip-pdf.ts's per-period Payslip. BESPOKE hand-drawn
 * document following the same header/info-grid/table/signature conventions.
 */
export async function buildSalaryLetterPdf(data: SalaryLetterData): Promise<Buffer> {
    const { companyNameFull } = await getActiveBrandNames();
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const reportFont = ensureReportFontServer(doc);
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 15;

    const headerY = await drawPdfReportHeaderServer(doc, 'Salary Letter', { fontFamily: reportFont });
    const brandRgb = getDocBrandPrimaryRgb(doc);

    let y = headerY + 6;
    doc.setFontSize(9);
    doc.setFont(reportFont, 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(`Date: ${data.issueDate}`, pageW - margin, y, { align: 'right' });

    y += 6;
    doc.setFillColor(248, 250, 252);
    doc.rect(margin, y, pageW - margin * 2, 22, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.rect(margin, y, pageW - margin * 2, 22, 'S');

    const info: [string, string][] = [
        ['Employee Name', data.employeeName],
        ['Employee Code', data.employeeCode],
        ['Designation', data.designation],
        ['Department', data.department],
        ['Branch', data.branchName],
    ];
    info.forEach(([label, value], i) => {
        const rowY = y + 6 + i * 4.5;
        doc.setFontSize(8);
        doc.setFont(reportFont, 'bold');
        doc.setTextColor(100, 116, 139);
        doc.text(label, margin + 3, rowY);
        doc.setFont(reportFont, 'normal');
        doc.setTextColor(15, 23, 42);
        doc.text(String(value), margin + 45, rowY);
    });

    y += 22 + 10;
    doc.setFontSize(10);
    doc.setFont(reportFont, 'normal');
    doc.setTextColor(15, 23, 42);
    const intro = doc.splitTextToSize(
        `This letter confirms your current monthly and annual salary structure with ${companyNameFull}, effective as per your employment records.`,
        pageW - margin * 2
    );
    doc.text(intro, margin, y);
    y += intro.length * 5.2 + 6;

    const monthlyTotal = data.components.reduce((sum, c) => sum + c.monthlyAmount, 0);
    const tableBody = data.components.map((c) => [c.name, `Rs. ${fmt(c.monthlyAmount)}`, `Rs. ${fmt(c.monthlyAmount * 12)}`]);
    tableBody.push(['Total (CTC)', `Rs. ${fmt(monthlyTotal)}`, `Rs. ${fmt(monthlyTotal * 12)}`]);

    autoTable(doc, {
        startY: y,
        head: [['Component', 'Monthly (Rs.)', 'Annual (Rs.)']],
        body: tableBody,
        theme: 'grid',
        headStyles: { font: reportFont, fillColor: brandRgb, textColor: [255, 255, 255], fontSize: 8, fontStyle: 'bold' },
        bodyStyles: { font: reportFont, fontSize: 8, textColor: [51, 65, 85] },
        columnStyles: {
            1: { halign: 'right' },
            2: { halign: 'right' },
        },
        willDrawCell: (hookData) => {
            if (hookData.row.index === tableBody.length - 1 && hookData.section === 'body') {
                hookData.cell.styles.fillColor = [226, 232, 240];
                hookData.cell.styles.fontStyle = 'bold';
            }
        },
        margin: { left: margin, right: margin },
    });

    const finalY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 20;
    doc.setDrawColor(...brandRgb);
    doc.setLineWidth(0.4);
    doc.line(margin, finalY, margin + 55, finalY);
    doc.setFontSize(8);
    doc.setFont(reportFont, 'bold');
    doc.setTextColor(100, 116, 139);
    doc.text('Authorized Signatory', margin, finalY + 5);

    const pageH = doc.internal.pageSize.getHeight();
    doc.setFontSize(6.5);
    doc.setFont(reportFont, 'normal');
    doc.setTextColor(148, 163, 184);
    doc.text(
        `Computer-generated letter | ${companyNameFull.toUpperCase()} – Confidential`,
        pageW / 2,
        pageH - 10,
        { align: 'center' }
    );

    return Buffer.from(doc.output('arraybuffer'));
}
