import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { getDocBrandPrimaryRgb } from "@/app/lib/reports/pdf-brand-color";
import { drawPdfReportHeader } from "@/app/lib/reports/pdf-report-header";
import type { PdfHeaderDrawer } from "@/app/lib/reports/funder-report-pdf";

/**
 * Draws the Funder OS Report — trust header, then a single flat A4-landscape
 * table (no header grouping) with a trailing Grand Total row.
 */
export async function drawFunderOsReportPdf(
  doc: jsPDF,
  headers: string[],
  rows: (string | number)[][],
  meta: { subtitle: string },
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const headerY = await drawHeader(doc, "FUNDER OS REPORT", { subtitle: meta.subtitle, fontFamily: reportFont });

  autoTable(doc, {
    startY: headerY,
    head: [headers],
    body: rows,
    styles: { font: reportFont, fontSize: 7 },
    headStyles: { font: reportFont, fillColor: getDocBrandPrimaryRgb(doc), textColor: 255, fontStyle: "bold" },
  });
}
