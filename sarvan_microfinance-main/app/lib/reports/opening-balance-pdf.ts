import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { getDocBrandPrimaryRgb } from "@/app/lib/reports/pdf-brand-color";
import { drawPdfReportHeader } from "@/app/lib/reports/pdf-report-header";

/** Signature shared with gl-all-pdf.ts's PdfHeaderDrawer / gl-account-ledger-pdf.ts's
 * PdfHeaderDrawer — lets a server caller (no window/DOM) inject its own Node-safe
 * logo/font loading in place of the browser-only drawPdfReportHeader default. */
export type PdfHeaderDrawer = (
  doc: jsPDF,
  title: string,
  opts?: { subtitle?: string; fontFamily?: string }
) => Promise<number>;

export interface OpeningBalancePdfMeta {
  /** e.g. "Branch: BR01 - Sample Branch" — matches the Direct page's subtitle exactly. */
  subtitle: string;
}

/**
 * Draws the Opening Balance report — trust header, then a single flat table —
 * extracted verbatim from the Direct Download PDF logic in
 * components/accounts/OpeningBalanceClient.tsx's handleExportPDF, so the exact
 * same rendering can be reused by the Request Report queue's PDF builder (via an
 * injected Node-safe `drawHeader`) without duplicating the table logic.
 * `drawHeader` defaults to the browser drawPdfReportHeader, so the existing
 * Direct caller is unaffected by this extraction.
 */
export async function drawOpeningBalanceReport(
  doc: jsPDF,
  data: { headers: string[]; rows: (string | number)[][] },
  meta: OpeningBalancePdfMeta,
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const headerY = await drawHeader(doc, "OPENING BALANCE DETAILS", {
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
