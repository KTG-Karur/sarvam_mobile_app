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

export interface VoucherPrintPdfMeta {
  /** The voucher date, already formatted exactly as the Direct page's subtitle
   * (formatDate(voucherDate + 'T00:00:00')). */
  subtitle: string;
}

/**
 * Draws the Voucher List/Summary PDF (NOT the single-voucher slip — that export,
 * handleExportSlipPDF in the Direct page, is a dialog-only feature with no
 * reportSlug/queue entry point and is out of scope for this migration) — trust
 * header, then a single flat table with a trailing TOTAL row — extracted
 * verbatim from the Direct Download PDF logic in
 * app/dashboard/admin-reports/account/voucher-print/page.tsx's handleExportPDF,
 * so the exact same rendering can be reused by the Request Report queue's PDF
 * builder (via an injected Node-safe `drawHeader`) without duplicating the
 * table logic. `drawHeader` defaults to the browser drawPdfReportHeader, so the
 * existing Direct caller is unaffected by this extraction.
 */
export async function drawVoucherPrintReport(
  doc: jsPDF,
  rows: (string | number)[][],
  meta: VoucherPrintPdfMeta,
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const headerY = await drawHeader(doc, "VOUCHER LIST", {
    subtitle: meta.subtitle,
    fontFamily: reportFont,
  });

  autoTable(doc, {
    head: [["Voucher No", "Type", "Date", "Dr Account", "Cr Account", "Amount (₹)", "Narration"]],
    body: rows,
    startY: headerY,
    theme: "grid",
    headStyles: { font: reportFont, fillColor: [67, 56, 202], textColor: 255, fontStyle: "bold" },
    columnStyles: { 5: { halign: "right" } },
    styles: { font: reportFont, fontSize: 8, cellPadding: 2.5 },
  });
}
