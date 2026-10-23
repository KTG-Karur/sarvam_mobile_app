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

/**
 * Draws the Insurance report — trust header, then a single flat
 * A4-landscape table (no header grouping, no totals row — non-additive
 * personal/policy records) — extracted verbatim from the Direct Download
 * PDF logic in components/reports/InsuranceReportClient.tsx's
 * handleExportPDF / buildInsuranceExportRows, so the exact same rendering
 * can be reused by the Request Report queue's PDF builder (via an
 * injected Node-safe `drawHeader`) without duplicating the table logic.
 * `drawHeader` defaults to the browser drawPdfReportHeader, so the
 * existing Direct caller is unaffected by this extraction.
 */
export async function drawInsuranceReportPdf(
  doc: jsPDF,
  headers: string[],
  rows: (string | number)[][],
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const headerY = await drawHeader(doc, "INSURANCE REPORT", { fontFamily: reportFont });

  autoTable(doc, {
    startY: headerY,
    head: [headers],
    body: rows,
    styles: { fontSize: 7, font: reportFont },
    headStyles: { fillColor: getDocBrandPrimaryRgb(doc), textColor: 255, fontStyle: "bold", font: reportFont },
  });
}
