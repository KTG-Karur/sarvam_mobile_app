import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { drawPdfReportHeader } from "@/app/lib/reports/pdf-report-header";
import { formatReportAmount } from "@/app/lib/utils/format-amount";
import { toDisplayDate } from '@/app/lib/date-format';

/** Signature shared with the other migrated reports' PdfHeaderDrawer — lets a server caller
 * (no window/DOM) inject its own Node-safe logo/font loading in place of the browser-only
 * drawPdfReportHeader default. */
export type PdfHeaderDrawer = (
  doc: jsPDF,
  title: string,
  opts?: { subtitle?: string; fontFamily?: string }
) => Promise<number>;

export interface LoanIndexLoanRow {
  slNo: number;
  clientId: string;
  clientName: string;
  nominee: string;
  highmarkScore?: number | null;
  highmarkStatus?: string;
  loanOs: number;
  arrear: number;
  loanSlNo: number;
  loanAmount: number;
  totalDues: number | string;
  purpose: string;
}

export interface LoanIndexReportData {
  metadata: {
    branchCode: string;
    branchName: string;
    centerName: string;
    centerLeader: string;
    officerCode: string;
    officerName: string;
    totalClients: number;
    centerOs: number;
    centerArrear: number;
    indexDate: string;
    indexNo: string;
  };
  loans: LoanIndexLoanRow[];
}

/**
 * Draws the Loan Index Report — trust header, a metadata key-value grid
 * (plain-theme autoTable), a dividing line, the main data table (grouped
 * TOTALS row via colSpan), and a signatures footer — extracted verbatim from
 * the Direct Download PDF logic in components/reports/LoanIndexClient.tsx's
 * handlePdfExport, so the exact same rendering can be reused by the Request
 * Report queue's PDF builder (via an injected Node-safe `drawHeader`) without
 * duplicating the drawing logic. `drawHeader` defaults to the browser
 * drawPdfReportHeader, so the existing Direct caller is unaffected by this
 * extraction.
 */
export async function drawLoanIndexReport(
  doc: jsPDF,
  reportData: LoanIndexReportData,
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const headerY = await drawHeader(doc, "Loan Index Report", {
    subtitle: `${reportData.metadata.branchCode} - ${reportData.metadata.branchName}`,
    fontFamily: reportFont,
  });

  const totalLoanAmount = reportData.loans.reduce((sum, item) => sum + item.loanAmount, 0);
  const totalClientOs = reportData.loans.reduce((sum, item) => sum + item.loanOs, 0);
  const totalClientArrear = reportData.loans.reduce((sum, item) => sum + item.arrear, 0);

  // Metadata Grid
  autoTable(doc, {
    startY: headerY,
    body: [
      [
        { content: "CENTER NAME:", styles: { fontStyle: "bold" as any } },
        reportData.metadata.centerName,
        { content: "OFFICER NAME:", styles: { fontStyle: "bold" as any } },
        `${reportData.metadata.officerCode} - ${reportData.metadata.officerName}`,
      ],
      [
        { content: "CENTER LEADER:", styles: { fontStyle: "bold" as any } },
        reportData.metadata.centerLeader || "-",
        { content: "TOTAL CLIENTS:", styles: { fontStyle: "bold" as any } },
        reportData.metadata.totalClients.toString(),
      ],
      [
        { content: "CENTER O/S:", styles: { fontStyle: "bold" as any } },
        `Rs.${formatReportAmount(reportData.metadata.centerOs)} / Arrear: Rs.${formatReportAmount(reportData.metadata.centerArrear)}`,
        { content: "INDEX DATE:", styles: { fontStyle: "bold" as any } },
        toDisplayDate(new Date(reportData.metadata.indexDate)),
      ],
      [
        { content: "INDEX NO:", styles: { fontStyle: "bold" as any } },
        { content: reportData.metadata.indexNo, styles: { font: "courier" } },
        "",
        "",
      ],
    ],
    theme: "plain",
    styles: { font: reportFont, fontSize: 8, cellPadding: 1 },
    columnStyles: {
      0: { cellWidth: 35 },
      1: { cellWidth: 60 },
      2: { cellWidth: 35 },
      3: { cellWidth: 60 },
    },
  });

  // Dividing Line
  doc.line(15, (doc as any).lastAutoTable.finalY + 2, 195, (doc as any).lastAutoTable.finalY + 2);

  // Main Report Table
  autoTable(doc, {
    startY: (doc as any).lastAutoTable.finalY + 5,
    head: [["SL No", "Client ID", "Client Name", "Nominee", "High Mark", "Loan O/S", "Arrear", "Cycle", "Amount", "Dues", "Purpose"]],
    body: [
      ...reportData.loans.map((loan) => [
        loan.slNo,
        loan.clientId,
        { content: loan.clientName, styles: { fontStyle: "bold" as any } },
        loan.nominee,
        loan.highmarkScore != null ? String(loan.highmarkScore) : loan.highmarkStatus || "N/A",
        formatReportAmount(loan.loanOs),
        formatReportAmount(loan.arrear),
        loan.loanSlNo,
        { content: formatReportAmount(loan.loanAmount), styles: { fontStyle: "bold" as any, halign: "right" as any } },
        loan.totalDues,
        loan.purpose,
      ]),
      [
        { content: "TOTALS:", colSpan: 5, styles: { halign: "right" as any, fontStyle: "bold" as any } },
        { content: formatReportAmount(totalClientOs), styles: { fontStyle: "bold" as any, halign: "right" as any } },
        { content: formatReportAmount(totalClientArrear), styles: { fontStyle: "bold" as any, halign: "right" as any } },
        "",
        { content: formatReportAmount(totalLoanAmount), styles: { fontStyle: "bold" as any, halign: "right" as any } },
        { content: "", colSpan: 2 },
      ],
    ],
    theme: "grid",
    styles: { font: reportFont, fontSize: 7, cellPadding: 1.2, lineColor: [0, 0, 0], lineWidth: 0.1, textColor: [0, 0, 0] },
    headStyles: { font: reportFont, fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: "bold" as any, halign: "center" as any },
    columnStyles: {
      0: { halign: "center" as any, cellWidth: 10 },
      1: { halign: "center" as any, cellWidth: 22 },
      4: { halign: "center" as any },
      5: { halign: "right" as any },
      6: { halign: "right" as any },
      7: { halign: "center" as any },
      9: { halign: "center" as any },
    },
  });

  // Signatures Footer
  const finalY = (doc as any).lastAutoTable.finalY + 15;

  doc.setFontSize(9);
  doc.setFont(reportFont, "bold");

  doc.text("__________________________", 15, finalY);
  doc.text("Prepared By (FDO)", 15, finalY + 5);

  doc.text("__________________________", 105, finalY, { align: "center" });
  doc.text("Verified By (BM)", 105, finalY + 5, { align: "center" });

  doc.text("__________________________", 195, finalY, { align: "right" });
  doc.text("Manager Signature", 195, finalY + 5, { align: "right" });
}
