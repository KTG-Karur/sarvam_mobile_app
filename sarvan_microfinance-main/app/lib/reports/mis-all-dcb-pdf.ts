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

export interface MisAllDcbPdfMeta {
  /** e.g. "Period: 01 Jan 2026 to 31 Jan 2026" — matches the Direct page's subtitle exactly. */
  subtitle: string;
}

/**
 * Draws the MIS All Branch DCB report — trust header, then a single flat
 * A3-landscape table with a trailing Grand Total row (no header grouping —
 * confirmed this report has no grouped-header signal in any renderer) —
 * extracted verbatim from the Direct Download PDF logic in
 * app/dashboard/mis-reports/all-dcb/page.tsx's handleExportPDF, so the exact
 * same rendering can be reused by the Request Report queue's PDF builder
 * (via an injected Node-safe `drawHeader`) without duplicating the table
 * logic. `drawHeader` defaults to the browser drawPdfReportHeader, so the
 * existing Direct caller is unaffected by this extraction.
 */
export async function drawMisAllDcbReport(
  doc: jsPDF,
  data: { headers: string[]; rows: (string | number)[][] },
  meta: MisAllDcbPdfMeta,
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const headerY = await drawHeader(doc, "ALL BRANCH DCB REPORT", {
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
