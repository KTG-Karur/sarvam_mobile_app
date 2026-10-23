import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { getDocBrandPrimaryRgb } from "@/app/lib/reports/pdf-brand-color";
import { drawPdfReportHeader } from "@/app/lib/reports/pdf-report-header";
import { truncateReportAmount } from "@/app/lib/utils/format-amount";

/** Signature shared with the other migrated reports' PdfHeaderDrawer — lets a server caller
 * (no window/DOM) inject its own Node-safe logo/font loading in place of the browser-only
 * drawPdfReportHeader default. */
export type PdfHeaderDrawer = (
  doc: jsPDF,
  title: string,
  opts?: { subtitle?: string; fontFamily?: string }
) => Promise<number>;

export interface OsCenterwiseRow {
  branchName: string;
  centerName: string;
  noOfClients: number;
  osPrincipal: number;
  osInterest: number;
  arrClients: number;
  arrearPri: number;
  arrearInt: number;
}

export interface OsCenterwiseTotals {
  totalClients: number;
  totalOSPrincipal: number;
  totalOSInterest: number;
  totalArrClients: number;
  totalArrearPri: number;
  totalArrearInt: number;
}

/**
 * Draws the Outstanding Centerwise report — trust header, then a single
 * flat A4-landscape table (no header grouping — grouping exists only in
 * the separate Word export path) with a trailing TOTAL row — extracted
 * verbatim from the Direct Download PDF logic in
 * app/dashboard/reports/portfolio/os-centerwise/page.tsx's handleExportPDF /
 * buildOSCenterwiseExportRows, so the exact same rendering can be reused by
 * the Request Report queue's PDF builder (via an injected Node-safe
 * `drawHeader`) without duplicating the table logic. `drawHeader` defaults
 * to the browser drawPdfReportHeader, so the existing Direct caller is
 * unaffected by this extraction. NOTE: deliberately does NOT adopt the
 * sibling os-branchwise report's extra `cellPadding`/`alternateRowStyles`
 * — this report's Direct PDF never had them, so adding them would be a
 * (subtle, unrequested) visual change, not a faithful extraction.
 */
export async function drawOsCenterwiseReport(
  doc: jsPDF,
  data: OsCenterwiseRow[],
  totals: OsCenterwiseTotals,
  meta: { subtitle: string },
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const headers = [
    "Branch Name", "Center Name", "No. of Clients", "OS Principal", "OS Interest",
    "Arrear Clients", "Arrear Principal", "Arrear Interest",
  ];
  const rows: (string | number)[][] = data.map((e) => [
    e.branchName, e.centerName, e.noOfClients, truncateReportAmount(e.osPrincipal), truncateReportAmount(e.osInterest),
    e.arrClients, truncateReportAmount(e.arrearPri), truncateReportAmount(e.arrearInt),
  ]);
  rows.push([
    "TOTAL", "", totals.totalClients, truncateReportAmount(totals.totalOSPrincipal), truncateReportAmount(totals.totalOSInterest),
    totals.totalArrClients, truncateReportAmount(totals.totalArrearPri), truncateReportAmount(totals.totalArrearInt),
  ]);

  const headerY = await drawHeader(doc, "OUTSTANDING CENTERWISE REPORT", {
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
