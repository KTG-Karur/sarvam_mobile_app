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

export interface BalanceInformationPdfMeta {
  /** e.g. "As on 2026-01-31" — matches the Direct page's subtitle exactly. */
  subtitle: string;
}

/**
 * Draws the Client Balance Information report — trust header, then a single
 * flat A4-landscape table with a trailing Grand Total row (no header
 * grouping — the PDF path is flat; grouping exists only in the separate
 * Word export path) — extracted verbatim from the Direct Download PDF logic
 * in components/reports/BalanceInformationReport.tsx's handleExportPDF, so
 * the exact same rendering can be reused by the Request Report queue's PDF
 * builder (via an injected Node-safe `drawHeader`) without duplicating the
 * table logic. `drawHeader` defaults to the browser drawPdfReportHeader, so
 * the existing Direct caller is unaffected by this extraction.
 */
export async function drawBalanceInformationReport(
  doc: jsPDF,
  data: { headers: string[]; rows: (string | number)[][] },
  meta: BalanceInformationPdfMeta,
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const headerY = await drawHeader(doc, "BALANCE CONFIRMATION REPORT", {
    subtitle: meta.subtitle,
    fontFamily: reportFont,
  });

  autoTable(doc, {
    startY: headerY,
    head: [data.headers],
    body: data.rows,
    styles: { fontSize: 7, font: reportFont },
    headStyles: { fillColor: getDocBrandPrimaryRgb(doc), textColor: 255, fontStyle: "bold", font: reportFont },
  });
}
