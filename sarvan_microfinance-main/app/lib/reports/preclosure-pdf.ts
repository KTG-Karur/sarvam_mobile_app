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

export interface PreclosureRow {
  precloseDate: string;
  branchName: string;
  centerName: string;
  clientName: string;
  loanAccount: string;
  arrearPri: number;
  arrearInt: number;
  currDmdPri: number;
  currDmdInt: number;
  preclosurePri: number;
  preclosureInt: number;
  totalAmount: number;
}

/**
 * Draws the Preclosure Report Consolidated — trust header, then a single
 * flat A4-landscape table (no header grouping — grouping exists only in
 * the separate Word export path) with a trailing "Grand Total:" row —
 * extracted verbatim from the Direct Download PDF logic in
 * components/mis-reports/PreclosureClient.tsx's handleExportPDF /
 * buildPreclosureExportRows, so the exact same rendering can be reused by
 * the Request Report queue's PDF builder (via an injected Node-safe
 * `drawHeader`) without duplicating the table logic. `drawHeader` defaults
 * to the browser drawPdfReportHeader, so the existing Direct caller is
 * unaffected by this extraction.
 */
export async function drawPreclosureReport(
  doc: jsPDF,
  searchedRows: PreclosureRow[],
  meta: { subtitle: string },
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const headers = ["Preclose Date", "Branch Name", "Center Name", "Client Name", "Loan A/c", "Arrear Pri", "Arrear Int", "Curr Dmd Pri", "Curr Dmd Int", "Preclosure Pri", "Preclosure Int", "Total Amount"];
  const rows: (string | number)[][] = searchedRows.map((item) => [
    item.precloseDate, item.branchName, item.centerName, item.clientName, item.loanAccount,
    item.arrearPri, item.arrearInt, item.currDmdPri, item.currDmdInt, item.preclosurePri, item.preclosureInt, item.totalAmount,
  ]);
  if (searchedRows.length > 0) {
    const sum = (key: keyof PreclosureRow) => searchedRows.reduce((s, r) => s + (r[key] as number), 0);
    rows.push([
      "Grand Total:", "", "", "", "",
      sum("arrearPri"), sum("arrearInt"), sum("currDmdPri"), sum("currDmdInt"),
      sum("preclosurePri"), sum("preclosureInt"), sum("totalAmount"),
    ]);
  }

  const headerY = await drawHeader(doc, "PRECLOSURE REPORT CONSOLIDATED", {
    subtitle: meta.subtitle,
    fontFamily: reportFont,
  });

  autoTable(doc, {
    startY: headerY,
    head: [headers],
    body: rows,
    styles: { font: reportFont, fontSize: 7 },
    headStyles: { font: reportFont, fillColor: getDocBrandPrimaryRgb(doc), textColor: 255, fontStyle: "bold" },
  });
}
