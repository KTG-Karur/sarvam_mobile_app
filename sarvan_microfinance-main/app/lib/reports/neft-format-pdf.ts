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

export interface NeftFormatPdfMeta {
  /** e.g. "Index Number(s): 123, 124" — matches the Direct page's subtitle exactly. */
  subtitle: string;
}

/**
 * Draws the NEFT Format report — trust header, then a single flat
 * A3-landscape table with a trailing Grand Total row (no header grouping —
 * the PDF path is flat; grouping exists only in the separate Word export
 * path) — extracted verbatim from the Direct Download PDF logic in
 * components/reports/NEFTFormatClient.tsx's handleExportPDF, so the exact
 * same rendering can be reused by the Request Report queue's PDF builder
 * (via an injected Node-safe `drawHeader`) without duplicating the table
 * logic. `drawHeader` defaults to the browser drawPdfReportHeader, so the
 * existing Direct caller is unaffected by this extraction.
 */
export async function drawNeftFormatReport(
  doc: jsPDF,
  data: { headers: string[]; rows: (string | number)[][] },
  meta: NeftFormatPdfMeta,
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const headerY = await drawHeader(doc, "NEFT FORMAT REPORT", {
    subtitle: meta.subtitle,
    fontFamily: reportFont,
  });

  autoTable(doc, {
    startY: headerY,
    head: [data.headers],
    body: data.rows,
    styles: { fontSize: 7, cellPadding: 1.5, font: reportFont },
    headStyles: { fillColor: getDocBrandPrimaryRgb(doc), textColor: 255, fontStyle: "bold", font: reportFont },
    alternateRowStyles: { fillColor: getDocBrandTintRgb(doc) },
  });
}
