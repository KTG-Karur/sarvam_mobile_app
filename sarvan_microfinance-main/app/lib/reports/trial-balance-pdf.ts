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
 * Draws the Trial Balance report — trust header, then a single flat
 * A4-landscape table (no header grouping — the on-screen table and the
 * Word export both group Opening/Transaction/Closing under a 2-row
 * header, but Direct's own PDF is flat, same as CSV) with a trailing
 * GRAND TOTAL row already baked into `rows` — extracted verbatim from the
 * Direct Download PDF logic in components/accounts/TrialBalanceClient.tsx's
 * handleExportPDF / buildTrialBalanceExportRows, so the exact same
 * rendering can be reused by the Request Report queue's PDF builder (via
 * an injected Node-safe `drawHeader`) without duplicating the table logic.
 * `drawHeader` defaults to the browser drawPdfReportHeader, so the
 * existing Direct caller is unaffected by this extraction. This is a
 * faithful "make Queue match Direct" fix — it does not add the grouped
 * header or bolded totals the on-screen table/Word export have, since
 * Direct's own PDF lacks them too.
 */
export async function drawTrialBalanceReport(
  doc: jsPDF,
  headers: string[],
  rows: (string | number)[][],
  meta: { subtitle: string },
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const headerY = await drawHeader(doc, "TRIAL BALANCE REPORT", { subtitle: meta.subtitle, fontFamily: reportFont });

  autoTable(doc, {
    head: [headers],
    body: rows,
    startY: headerY,
    theme: "grid",
    headStyles: { font: reportFont, fillColor: "#1346A2", textColor: "#ffffff", fontStyle: "bold", halign: "center" },
    styles: { font: reportFont, fontSize: 7, cellPadding: 2, textColor: "#000000", fontStyle: "normal" },
    columnStyles: { 1: { cellWidth: 70 } },
  });
}
