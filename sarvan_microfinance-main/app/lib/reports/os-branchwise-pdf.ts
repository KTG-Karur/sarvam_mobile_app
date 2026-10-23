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

export interface OsBranchwisePdfMeta {
  /** e.g. "As of 31 Aug 2026" — matches the Direct page's subtitle exactly. */
  subtitle: string;
}

/**
 * Draws the Outstanding Branchwise Report — trust header, then a single flat
 * table with a trailing GRAND TOTAL row (no header grouping — the OS/ARREAR
 * grouping exists only in the separate Word export path, not here) —
 * extracted verbatim from the Direct Download PDF logic in
 * app/dashboard/admin-reports/portfolio/os-branchwise/page.tsx's
 * handleExport('pdf'), so the exact same rendering can be reused by the
 * Request Report queue's PDF builder (via an injected Node-safe
 * `drawHeader`) without duplicating the table logic. `drawHeader` defaults
 * to the browser drawPdfReportHeader, so the existing Direct caller is
 * unaffected by this extraction.
 */
export async function drawOsBranchwiseReport(
  doc: jsPDF,
  data: { headers: string[]; rows: (string | number)[][] },
  meta: OsBranchwisePdfMeta,
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const headerY = await drawHeader(doc, "Outstanding Branchwise Report", {
    subtitle: meta.subtitle,
    fontFamily: reportFont,
  });

  autoTable(doc, {
    startY: headerY,
    head: [data.headers],
    body: data.rows,
    styles: { font: reportFont, fontSize: 7, cellPadding: 1.5 },
    headStyles: { font: reportFont, fillColor: getDocBrandPrimaryRgb(doc), textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: getDocBrandTintRgb(doc) },
  });
}
