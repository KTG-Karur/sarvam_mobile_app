import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { getDocBrandPrimaryRgb } from "@/app/lib/reports/pdf-brand-color";
import { drawPdfReportHeader } from "@/app/lib/reports/pdf-report-header";

/** Signature shared with gl-all-pdf.ts / gl-account-ledger-pdf.ts / opening-balance-pdf.ts's
 * PdfHeaderDrawer — lets a server caller (no window/DOM) inject its own Node-safe logo/font
 * loading in place of the browser-only drawPdfReportHeader default. */
export type PdfHeaderDrawer = (
  doc: jsPDF,
  title: string,
  opts?: { subtitle?: string; fontFamily?: string }
) => Promise<number>;

export interface MisLedgerReportPdfMeta {
  /** e.g. "Ledger: Bank  •  Period: 01 Jan 2026 to 31 Jan 2026" — matches the Direct page's
   * subtitle exactly. */
  subtitle: string;
}

/**
 * Draws the MIS Ledger Report — trust header, then a single flat table (OPENING BALANCE /
 * per-transaction rows / TOTAL / CLOSING BALANCE rows baked directly into the row data) —
 * extracted verbatim from the Direct Download PDF logic in
 * components/mis-reports/LedgerReportClient.tsx's handleExportPDF, so the exact same
 * rendering can be reused by the Request Report queue's PDF builder (via an injected
 * Node-safe `drawHeader`) without duplicating the table logic. `drawHeader` defaults to the
 * browser drawPdfReportHeader, so the existing Direct caller is unaffected by this extraction.
 */
export async function drawMisLedgerReport(
  doc: jsPDF,
  data: { headers: string[]; rows: (string | number)[][] },
  meta: MisLedgerReportPdfMeta,
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const headerY = await drawHeader(doc, "LEDGER REPORT", {
    subtitle: meta.subtitle,
    fontFamily: reportFont,
  });

  autoTable(doc, {
    startY: headerY,
    head: [data.headers],
    body: data.rows,
    styles: { font: reportFont, fontSize: 7 },
    headStyles: { font: reportFont, fillColor: getDocBrandPrimaryRgb(doc), textColor: 255, fontStyle: "bold" },
  });
}
