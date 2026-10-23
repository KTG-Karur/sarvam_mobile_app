import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { getDocBrandPrimaryRgb, getDocBrandTintRgb } from "@/app/lib/reports/pdf-brand-color";
import { drawPdfReportHeader } from "@/app/lib/reports/pdf-report-header";
import { getPersonLabel } from "@/app/lib/person-label";

/** Signature shared with the other migrated reports' PdfHeaderDrawer — lets a server caller
 * (no window/DOM) inject its own Node-safe logo/font loading in place of the browser-only
 * drawPdfReportHeader default. */
export type PdfHeaderDrawer = (
  doc: jsPDF,
  title: string,
  opts?: { subtitle?: string; fontFamily?: string }
) => Promise<number>;

export interface DropoutsRow {
  centerId: string;
  centerName: string;
  clientId: string;
  hasLoan?: boolean;
  clientName: string;
  joinedDate: string | null;
  lastLoanDisbursedDate: string | null;
  loanAc: string;
  lastLoanClosedDate: string | null;
  inactiveDate: string | null;
  reason: string;
  fdoName: string;
}

// Format date as "DD/MM/YYYY" — mirrors components/reports/DropoutsClient.tsx's formatDate()
function formatDate(dateString: string | null | undefined): string {
  if (!dateString) return "";
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateString)) {
    return dateString;
  }
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
 * Draws the Member / Client Dropouts report — trust header, then a single
 * flat A4-landscape table (no header grouping, no totals row — a client
 * list, not a financial roll-up) — extracted verbatim from the Direct
 * Download PDF logic in components/reports/DropoutsClient.tsx's
 * handleExportPDF / buildDropoutsExportRows, so the exact same rendering
 * can be reused by the Request Report queue's PDF builder (via an injected
 * Node-safe `drawHeader`) without duplicating the table logic. `drawHeader`
 * defaults to the browser drawPdfReportHeader, so the existing Direct
 * caller is unaffected by this extraction.
 */
export async function drawDropoutsReport(
  doc: jsPDF,
  searchedRows: DropoutsRow[],
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const headers = [
    "Center Id", "Center Name", "ID", "Name", "Member / Client", "Joined Date",
    "Last Loan Disbursed Date", "Loan A/c", "Last Loan Closed Date", "Inactive Date", "Reason", "FDO Name",
  ];
  const rows: (string | number)[][] = searchedRows.map((row) => [
    row.centerId, row.centerName, row.clientId, row.clientName,
    getPersonLabel(!!row.hasLoan).singular, formatDate(row.joinedDate),
    formatDate(row.lastLoanDisbursedDate), row.loanAc, formatDate(row.lastLoanClosedDate),
    formatDate(row.inactiveDate), row.reason, row.fdoName,
  ]);

  const headerY = await drawHeader(doc, "MEMBER / CLIENT DROPOUTS REPORT", {
    fontFamily: reportFont,
  });

  autoTable(doc, {
    startY: headerY,
    head: [headers],
    body: rows,
    styles: { fontSize: 7, cellPadding: 1.5, font: reportFont },
    headStyles: { fillColor: getDocBrandPrimaryRgb(doc), textColor: 255, fontStyle: "bold", font: reportFont },
    alternateRowStyles: { fillColor: getDocBrandTintRgb(doc) },
  });
}
