import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { getDocBrandPrimaryRgb } from "@/app/lib/reports/pdf-brand-color";
import { drawPdfReportHeader } from "@/app/lib/reports/pdf-report-header";
import type { PdfHeaderDrawer } from "@/app/lib/reports/transfer-pdf";

export interface CenterAssignmentHistoryRow {
  branchName: string;
  centerName: string;
  meetingDay: string;
  meetingSchedule: string;
  previousFdoName: string;
  previousFrom: string;
  previousTill: string;
  currentFdoName: string;
  currentFrom: string;
  assignedBy: string;
}

/**
 * Draws the Center Assignment History Report — trust header, then a single flat
 * A4-landscape table (no header grouping, no totals row — an assignment log,
 * not a financial roll-up). 10 columns, so a slightly smaller font than the
 * simpler Transfer History table keeps it legible without wrapping.
 */
export async function drawCenterAssignmentHistoryReport(
  doc: jsPDF,
  searchedRows: CenterAssignmentHistoryRow[],
  meta: { subtitle: string },
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const headers = [
    "Branch Name", "Center Name", "Meeting Day", "Meeting Schedule",
    "Previous FDO", "Previous From", "Previous Till",
    "Current FDO", "Assigned Date", "Assigned By",
  ];
  const rows: (string | number)[][] = searchedRows.map((row) => [
    row.branchName, row.centerName, row.meetingDay, row.meetingSchedule,
    row.previousFdoName, row.previousFrom, row.previousTill,
    row.currentFdoName, row.currentFrom, row.assignedBy,
  ]);

  const headerY = await drawHeader(doc, "CENTER ASSIGNMENT HISTORY REPORT", {
    subtitle: meta.subtitle,
    fontFamily: reportFont,
  });

  autoTable(doc, {
    startY: headerY,
    head: [headers],
    body: rows,
    styles: { fontSize: 6.5, font: reportFont },
    headStyles: { fillColor: getDocBrandPrimaryRgb(doc), textColor: 255, fontStyle: "bold", font: reportFont },
  });
}
