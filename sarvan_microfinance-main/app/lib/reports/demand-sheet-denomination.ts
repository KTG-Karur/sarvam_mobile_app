import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

/**
 * Demand Sheet denomination section — labels and order, shared by the on-screen
 * preview, PDF export, and Excel/CSV export so all three stay in sync.
 *
 * IMPORTANT: there is no stored/calculated denomination data anywhere in the
 * Demand Sheet feature (per-center or aggregate) — the per-center "Detailed
 * report" (components/reports/ClientWiseDemandReportDialog.tsx) renders this
 * exact same table as a BLANK manual fill-in-by-hand form (plain <input> boxes
 * with no bound value, and blank PDF cells). This module intentionally
 * preserves that same behavior rather than fabricating aggregated figures.
 */
export const DEMAND_SHEET_DENOMINATION_LABELS = [
  "Rs.500",
  "Rs.200",
  "Rs.100",
  "Rs.50",
  "Rs.20",
  "Rs.10",
  "Coins",
  "UPI",
  "Total",
] as const;

/**
 * Draws the same blank DENOMINATION / signature block used by the per-center
 * "Detailed report" PDF (see buildDetailedReportPdf in
 * components/reports/ClientWiseDemandReportDialog.tsx) — duplicated here (not
 * imported) so that file is never touched by this change.
 */
export async function drawDemandSheetDenominationBlock(
  doc: jsPDF,
  startY: number,
  reportFont: string
): Promise<void> {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 10;

  let currentY = startY + 6;
  if (currentY + 65 > pageHeight) {
    doc.addPage();
    currentY = 15;
  }

  const tableStartX = margin;
  const denomTableWidth = 95;

  const denomBody: string[][] = DEMAND_SHEET_DENOMINATION_LABELS.map((label) => [label, "", ""]);

  autoTable(doc, {
    startY: currentY,
    margin: { left: tableStartX, right: pageWidth - tableStartX - denomTableWidth },
    tableWidth: denomTableWidth,
    head: [
      [
        { content: "DENOMINATION", styles: { halign: "center", fontStyle: "bold" } },
        { content: "COUNT", styles: { halign: "center", fontStyle: "bold" } },
        { content: "VALUE", styles: { halign: "center", fontStyle: "bold" } },
      ],
    ],
    body: denomBody,
    theme: "grid",
    styles: { font: reportFont },
    headStyles: {
      font: reportFont,
      fillColor: [243, 244, 246],
      textColor: [17, 24, 39],
      fontSize: 7,
      lineColor: [0, 0, 0],
      lineWidth: 0.1,
      cellPadding: 1.5,
    },
    bodyStyles: {
      fontSize: 6.5,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.1,
      cellPadding: 1.2,
    },
    columnStyles: {
      0: { cellWidth: 35, halign: "left" },
      1: { cellWidth: 30, halign: "center" },
      2: { cellWidth: 30, halign: "center" },
    },
    didDrawCell: (data) => {
      if (data.section === "body" && data.row.index === DEMAND_SHEET_DENOMINATION_LABELS.length - 1) {
        data.cell.styles.fillColor = [249, 250, 251];
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  const sigY = currentY + 36;
  const sigStartX = tableStartX + denomTableWidth + 10;
  const sigTotalWidth = pageWidth - margin - sigStartX;
  const sigSlotWidth = sigTotalWidth / 3;

  doc.setFontSize(8);
  doc.setFont(reportFont, "bold");
  doc.text("Group Member Signature", sigStartX + sigSlotWidth * 0.5, sigY, { align: "center" });
  doc.text("FDO Signature", sigStartX + sigSlotWidth * 1.5, sigY, { align: "center" });
  doc.text("BM Signature", sigStartX + sigSlotWidth * 2.5, sigY, { align: "center" });
  doc.text("Receipt No:", sigStartX + sigSlotWidth * 0.5, sigY + 8, { align: "center" });
}

/**
 * Flat-row version of the same blank section, for Excel/CSV exports whose rows
 * share a single flat table shape (no separate "totals row" mechanism like Word
 * has) — padded/truncated to the export's actual column count.
 */
export function buildDemandSheetDenominationRows(columnCount: number): (string | number)[][] {
  const pad = (cells: (string | number)[]): (string | number)[] => {
    const row = [...cells];
    while (row.length < columnCount) row.push("");
    return row.slice(0, columnCount);
  };

  const rows: (string | number)[][] = [];
  rows.push(pad([]));
  rows.push(pad(["DENOMINATION", "COUNT", "VALUE"]));
  DEMAND_SHEET_DENOMINATION_LABELS.forEach((label) => {
    rows.push(pad([label, "", ""]));
  });
  rows.push(pad([]));
  rows.push(pad(["Group Member Signature", "", "Receipt No."]));
  rows.push(pad(["FDO Signature"]));
  rows.push(pad(["BM Signature"]));
  return rows;
}
