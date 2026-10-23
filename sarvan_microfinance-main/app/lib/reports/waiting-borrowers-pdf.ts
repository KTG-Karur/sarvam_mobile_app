import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { getDocBrandPrimaryRgb } from "@/app/lib/reports/pdf-brand-color";
import { drawPdfReportHeader } from "@/app/lib/reports/pdf-report-header";

/** Signature shared with the other migrated reports' PdfHeaderDrawer — lets a server caller
 * (no window/DOM) inject its own Node-safe logo/font loading in place of the browser-only
 * drawPdfReportHeader default. */
export type PdfHeaderDrawer = (
  doc: jsPDF,
  title: string,
  opts?: { subtitle?: string; fontFamily?: string }
) => Promise<number>;

/**
 * Draws the Waiting Borrowers report (both DETAILED and SUMMARY shapes) —
 * trust header, then a single flat A4-landscape table (no header
 * grouping) with a trailing "Grand Total:" row — extracted verbatim from
 * the Direct Download PDF logic in
 * components/reports/WaitingBorrowersClient.tsx's handleExportPDF /
 * buildWaitingBorrowersExportRows, so the exact same rendering can be
 * reused by the Request Report queue's PDF builder (via an injected
 * Node-safe `drawHeader`) without duplicating the table logic.
 * `drawHeader` defaults to the browser drawPdfReportHeader, so the
 * existing Direct caller is unaffected by this extraction.
 *
 * NOTE: Direct's on-page free-text search box filters `filteredData`
 * client-side before export, but that search string never leaves the
 * browser (not part of ReportFetchParams/exportParams) — a Queue PDF
 * requested while a search is active will include the full unfiltered
 * dataset. This is a structural, pre-existing gap in the Request Queue
 * contract, not something a PDF-only renderer fix can close.
 */
export async function drawWaitingBorrowersReport(
  doc: jsPDF,
  headers: string[],
  rows: (string | number)[][],
  meta: { reportType: string },
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const headerY = await drawHeader(doc, "WAITING BORROWERS REPORT", { subtitle: `${meta.reportType} REGISTRY`, fontFamily: reportFont });

  autoTable(doc, {
    startY: headerY,
    head: [headers],
    body: rows,
    styles: { fontSize: 7, font: reportFont },
    headStyles: { fillColor: getDocBrandPrimaryRgb(doc), textColor: 255, fontStyle: "bold", font: reportFont },
  });
}
