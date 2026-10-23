import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { getDocBrandPrimaryRgb, getDocBrandTintRgb } from "@/app/lib/reports/pdf-brand-color";
import { drawPdfReportHeader } from "@/app/lib/reports/pdf-report-header";

/** Signature shared with the other migrated reports' PdfHeaderDrawer — lets a server caller
 * (no window/DOM) inject its own Node-safe logo/font loading in place of the browser-only
 * drawPdfReportHeader default. */
export type PdfHeaderDrawer = (
  doc: jsPDF,
  title: string,
  opts?: { subtitle?: string; fontFamily?: string }
) => Promise<number>;

export type MisAgewiseReportType = "BRANCHWISE" | "CENTERWISE" | "FDOWISE" | "CLIENTWISE" | "DETAILEDWISE";

/**
 * Draws the MIS Age-wise Arrear report — trust header, then a single flat
 * A3-landscape table (no header grouping — grouping exists only in the
 * separate Word export path, for all 5 reportType modes) with a trailing
 * "Grand Total" row — extracted verbatim from the Direct Download PDF
 * logic in components/mis-reports/AgewiseArrearClient.tsx's
 * handleExportPDF / buildAgewiseArrearExportRows, so the exact same
 * rendering can be reused by the Request Report queue's PDF builder (via
 * an injected Node-safe `drawHeader`) without duplicating the table
 * logic. `drawHeader` defaults to the browser drawPdfReportHeader, so the
 * existing Direct caller is unaffected by this extraction.
 */
export async function drawMisAgewiseArrearReport(
  doc: jsPDF,
  reportType: MisAgewiseReportType,
  headers: string[],
  rows: (string | number)[][],
  meta: { subtitle: string },
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const headerY = await drawHeader(doc, `AGEWISE ARREAR REPORT — ${reportType}`, {
    subtitle: meta.subtitle,
    fontFamily: reportFont,
  });

  autoTable(doc, {
    startY: headerY,
    head: [headers],
    body: rows,
    styles: { font: reportFont, fontSize: 7, cellPadding: 1.5 },
    headStyles: { font: reportFont, fillColor: getDocBrandPrimaryRgb(doc), textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: getDocBrandTintRgb(doc) },
  });
}
