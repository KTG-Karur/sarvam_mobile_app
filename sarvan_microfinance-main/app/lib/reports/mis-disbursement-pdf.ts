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

export interface MisDisbursementPdfMeta {
  /** e.g. "Period: 01 Jan 2026 to 31 Jan 2026  •  Center: C001 - Sample" — matches the
   * Direct page's subtitle exactly. */
  subtitle: string;
}

/**
 * Draws the MIS Disbursement report — trust header, then a single flat
 * A3-landscape table with a trailing Grand Total row (no header grouping —
 * the PDF path is flat; grouping exists only in the separate Word export
 * path) — extracted verbatim from the Direct Download PDF logic in
 * app/dashboard/mis-reports/disbursement/page.tsx's handleExportPDF, so the
 * exact same rendering can be reused by the Request Report queue's PDF
 * builder (via an injected Node-safe `drawHeader`) without duplicating the
 * table logic. `drawHeader` defaults to the browser drawPdfReportHeader, so
 * the existing Direct caller is unaffected by this extraction.
 */
export async function drawMisDisbursementReport(
  doc: jsPDF,
  data: { headers: string[]; rows: (string | number)[][] },
  meta: MisDisbursementPdfMeta,
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const headerY = await drawHeader(doc, "DISBURSEMENT REPORT", {
    subtitle: meta.subtitle,
    fontFamily: reportFont,
  });

  autoTable(doc, {
    startY: headerY,
    head: [data.headers],
    body: data.rows,
    styles: { font: reportFont, fontSize: 7 },
    headStyles: { font: reportFont, fillColor: getDocBrandPrimaryRgb(doc), textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: getDocBrandTintRgb(doc) },
  });
}
