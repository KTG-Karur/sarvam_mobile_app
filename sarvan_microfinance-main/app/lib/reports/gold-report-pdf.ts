import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
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
 * Draws the Gold Taken / Gold Returned report — trust header, then a
 * single flat A4-landscape grid table (no header grouping — grouping
 * exists only in the separate Word export path) with a trailing Total
 * row already baked into `rows` — extracted verbatim from the Direct
 * Download PDF logic in components/reports/GoldReportPage.tsx's
 * handlePdfExport, so the exact same rendering can be reused by the
 * Request Report queue's PDF builder (via an injected Node-safe
 * `drawHeader`) without duplicating the table logic. `drawHeader` defaults
 * to the browser drawPdfReportHeader, so the existing Direct caller is
 * unaffected by this extraction. Shared by both "gold-taken" and
 * "gold-returned" slugs — same table config, different title/columns.
 */
export async function drawGoldReportPdf(
  doc: jsPDF,
  title: string,
  headers: (string | number)[],
  rows: (string | number)[][],
  meta: { subtitle: string },
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const headerY = await drawHeader(doc, title, { subtitle: meta.subtitle, fontFamily: reportFont });

  autoTable(doc, {
    startY: headerY,
    head: [headers],
    body: rows,
    theme: "grid",
    styles: { fontSize: 7, cellPadding: 1.2, lineColor: [0, 0, 0], lineWidth: 0.1, textColor: [0, 0, 0], font: reportFont },
    headStyles: { fillColor: [240, 240, 240], textColor: [0, 0, 0], fontStyle: "bold", halign: "center", font: reportFont },
  });
}
