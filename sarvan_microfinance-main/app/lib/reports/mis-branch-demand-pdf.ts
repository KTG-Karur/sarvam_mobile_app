import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { getDocBrandPrimaryRgb, getDocBrandTintRgb } from "@/app/lib/reports/pdf-brand-color";
import { drawPdfReportHeader } from "@/app/lib/reports/pdf-report-header";
import { formatReportAmount } from "@/app/lib/utils/format-amount";
import type { MISBranchDemandRow, MISBranchDemandTotals } from "@/app/lib/actions/reports";
import { toDisplayDate } from '@/app/lib/date-format';

/** Signature shared with the other migrated reports' PdfHeaderDrawer — lets a server caller
 * (no window/DOM) inject its own Node-safe logo/font loading in place of the browser-only
 * drawPdfReportHeader default. */
export type PdfHeaderDrawer = (
  doc: jsPDF,
  title: string,
  opts?: { subtitle?: string; fontFamily?: string }
) => Promise<number>;

const formatDateDisplay = (dateString: string) =>
  toDisplayDate(new Date(dateString));

/**
 * Draws the MIS Branch Demand report — trust header, then a single flat
 * A4-landscape table (no header grouping — 10 flat columns, no genuine
 * repeated-prefix pairs to group) with a trailing TOTAL row — extracted
 * verbatim from the Direct Download PDF logic in
 * app/dashboard/mis-reports/branch-demand/page.tsx's handleExportPDF /
 * buildBranchDemandExportRows, so the exact same rendering can be reused
 * by the Request Report queue's PDF builder (via an injected Node-safe
 * `drawHeader`) without duplicating the table logic. `drawHeader` defaults
 * to the browser drawPdfReportHeader, so the existing Direct caller is
 * unaffected by this extraction.
 *
 * Note this report's own trailing row is labeled "TOTAL" (not "GRAND
 * TOTAL"), unlike some sibling reports — preserved verbatim, not
 * normalized.
 */
export async function drawMisBranchDemandReport(
  doc: jsPDF,
  data: MISBranchDemandRow[],
  totals: MISBranchDemandTotals,
  meta: { fromDate: string; toDate: string },
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const headers = ["Meeting Date", "Branch Code", "Branch Name", "FDO Code", "FDO Name", "Centers", "Loan OS", "Arrear", "Curr Demand", "Total Demand"];
  const rows: (string | number)[][] = data.map((e) => [
    e.meetingDate, e.branchCode, e.branchName, e.fdoCode, e.fdoName,
    e.centers, formatReportAmount(e.loanOS), formatReportAmount(e.arrear), formatReportAmount(e.currDemand), formatReportAmount(e.totalDemand),
  ]);
  rows.push([
    "TOTAL", "", "", "", "",
    totals.totalCenters, formatReportAmount(totals.totalLoanOS), formatReportAmount(totals.totalArrear), formatReportAmount(totals.totalCurrDemand), formatReportAmount(totals.totalDemand),
  ]);

  const headerY = await drawHeader(doc, "MIS BRANCH DEMAND REPORT", {
    subtitle: `Period: ${formatDateDisplay(meta.fromDate)} to ${formatDateDisplay(meta.toDate)}`,
    fontFamily: reportFont,
  });

  autoTable(doc, {
    startY: headerY,
    head: [headers],
    body: rows,
    styles: { font: reportFont, fontSize: 7, cellPadding: 1.5 },
    headStyles: { font: reportFont, fillColor: getDocBrandPrimaryRgb(doc), textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: getDocBrandTintRgb(doc) },
  });
}
