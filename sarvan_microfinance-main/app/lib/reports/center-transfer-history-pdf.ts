import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { getDocBrandPrimaryRgb } from "@/app/lib/reports/pdf-brand-color";
import { drawPdfReportHeader } from "@/app/lib/reports/pdf-report-header";
import type { PdfHeaderDrawer } from "@/app/lib/reports/transfer-pdf";

export interface CenterTransferHistoryRow {
  branchName: string;
  centerName: string;
  previousFdoName: string;
  currentFdoName: string;
  date: string;
  approvedBy: string;
}

/**
 * Draws the Center Transfer History Report — trust header, then a single flat
 * A4-landscape table (no header grouping, no totals row — a transfer log,
 * not a financial roll-up).
 */
export async function drawCenterTransferHistoryReport(
  doc: jsPDF,
  searchedRows: CenterTransferHistoryRow[],
  meta: { subtitle: string },
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const headers = ["Branch Name", "Center Name", "Previous FDO", "Current FDO", "Date", "Approved By"];
  const rows: (string | number)[][] = searchedRows.map((row) => [
    row.branchName, row.centerName, row.previousFdoName, row.currentFdoName, row.date, row.approvedBy,
  ]);

  const headerY = await drawHeader(doc, "CENTER TRANSFER HISTORY REPORT", {
    subtitle: meta.subtitle,
    fontFamily: reportFont,
  });

  autoTable(doc, {
    startY: headerY,
    head: [headers],
    body: rows,
    styles: { fontSize: 8, font: reportFont },
    headStyles: { fillColor: getDocBrandPrimaryRgb(doc), textColor: 255, fontStyle: "bold", font: reportFont },
  });
}
