import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { getDocBrandPrimaryRgb } from "@/app/lib/reports/pdf-brand-color";
import { drawPdfReportHeader } from "@/app/lib/reports/pdf-report-header";
import { truncateReportAmount } from "@/app/lib/utils/format-amount";

/** Signature shared with the other migrated reports' PdfHeaderDrawer — lets a server caller
 * (no window/DOM) inject its own Node-safe logo/font loading in place of the browser-only
 * drawPdfReportHeader default. */
export type PdfHeaderDrawer = (
  doc: jsPDF,
  title: string,
  opts?: { subtitle?: string; fontFamily?: string }
) => Promise<number>;

export interface AdditionDisbursedRow {
  centerId: string;
  centerName: string;
  clientId: string;
  clientName: string;
  joinedDate: string;
  disbursalDate: string;
  loanAc: string;
  loanAmount: number;
  totalDues: number;
  funder: string;
  fdoName: string;
}

function formatDate(dateString: string): string {
  if (!dateString) return "";
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateString)) return dateString;
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  } catch {
    return dateString;
  }
}

/**
 * Draws the Client Addition Disbursed report — trust header, then a single
 * flat A4-landscape table with a trailing Grand Total row (no header
 * grouping) — extracted verbatim from the Direct Download PDF logic in
 * components/reports/AdditionDisbursedClient.tsx's handleExportPDF, so the
 * exact same rendering can be reused by the Request Report queue's PDF
 * builder (via an injected Node-safe `drawHeader`) without duplicating the
 * table logic. `drawHeader` defaults to the browser drawPdfReportHeader, so
 * the existing Direct caller is unaffected by this extraction.
 */
export async function drawAdditionDisbursedReport(
  doc: jsPDF,
  searchedRows: AdditionDisbursedRow[],
  meta: { subtitle: string },
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const headers = [
    "Center Id", "Center Name", "Client ID", "Client Name", "Joined Date", "Disbursal Date",
    "Loan A/c", "Loan Amount", "Total Dues", "Funder", "FDO Name",
  ];
  const rows: (string | number)[][] = searchedRows.map((row) => [
    row.centerId, row.centerName, row.clientId, row.clientName,
    formatDate(row.joinedDate), row.disbursalDate ? formatDate(row.disbursalDate) : "",
    row.loanAc || "", truncateReportAmount(row.loanAmount), truncateReportAmount(row.totalDues), row.funder || "", row.fdoName,
  ]);
  if (searchedRows.length > 0) {
    const totalLoanAmount = searchedRows.reduce((sum, row) => sum + (row.loanAmount || 0), 0);
    rows.push(["Grand Total", "", "", "", "", "", "", truncateReportAmount(totalLoanAmount), "", "", ""]);
  }

  const headerY = await drawHeader(doc, "CLIENT ADDITION DISBURSED REPORT", {
    subtitle: meta.subtitle,
    fontFamily: reportFont,
  });

  autoTable(doc, {
    startY: headerY,
    head: [headers],
    body: rows,
    styles: { fontSize: 7, font: reportFont },
    headStyles: { fillColor: getDocBrandPrimaryRgb(doc), textColor: 255, fontStyle: "bold", font: reportFont },
  });
}
