import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { DemandSheetData } from "@/app/lib/actions/demand";
import { drawPdfReportHeader } from "@/app/lib/reports/pdf-report-header";
import { formatReportAmount } from "@/app/lib/utils/format-amount";

/** Signature shared by the browser (pdf-report-header.ts) and Node
 * (pdf-report-header-server.ts) header drawers — lets a server caller inject
 * its own Node-safe logo/font loading without this module depending on either. */
export type DemandSheetHeaderDrawer = (
  doc: jsPDF,
  title: string,
  opts?: { subtitle?: string; fontFamily?: string }
) => Promise<number>;

export interface DemandSheetCenterwiseMeta {
  branchLabel: string;
  fdoName: string;
  dayName: string;
  formattedDate: string;
}

const formatCurrency = (amount: number): string => {
  if (amount === 0) return "0";
  return formatReportAmount(amount);
};

const formatTime = (timeString: string): string => {
  if (!timeString) return "";
  const time = timeString.replace("Z", "");
  return time.substring(0, 5);
};

/**
 * Draws the Centerwise Demand Sheet table (+ Grand Total row + BM/AM signature
 * line) onto the current page of `doc` — extracted verbatim from the Direct
 * Download PDF logic in
 * app/dashboard/reports/demand/demand-sheet/page.tsx's handleExportPdf, so the
 * exact same rendering can be reused by the Request Report queue's PDF builder
 * (via an injected Node-safe `drawHeader`) without duplicating the table/column
 * logic. `drawHeader` defaults to the browser drawPdfReportHeader so existing
 * (page.tsx) callers are unaffected.
 */
export async function drawDemandSheetCenterwisePage(
  doc: jsPDF,
  rows: DemandSheetData[],
  meta: DemandSheetCenterwiseMeta,
  reportFont: string,
  drawHeader: DemandSheetHeaderDrawer = drawPdfReportHeader,
  loanAdvanceEnabled: boolean = true
): Promise<void> {
  const { branchLabel, fdoName, dayName, formattedDate } = meta;

  const totalClients = rows.reduce((sum, e) => sum + e.noOfClients, 0);
  const totalWB = rows.reduce((sum, e) => sum + e.wb, 0);
  const totalLoanOS = rows.reduce((sum, e) => sum + e.loanOS, 0);
  const totalArrear = rows.reduce((sum, e) => sum + e.arrear, 0);
  const totalDemand = rows.reduce((sum, e) => sum + e.demand, 0);
  const totalCollected = rows.reduce((sum, e) => sum + e.collected, 0);

  const headerY = await drawHeader(doc, "Demand Sheet", {
    subtitle: "Empowering Women, Building Futures",
    fontFamily: reportFont,
  });

  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.setFont(reportFont, "bold");
  doc.text(`Branch:`, 40, headerY + 3);
  doc.setFont(reportFont, "normal");
  doc.text(branchLabel, 55, headerY + 3);

  doc.setFont(reportFont, "bold");
  doc.text(`FDO:`, 40, headerY + 9);
  doc.setFont(reportFont, "normal");
  doc.text(`${fdoName}`, 55, headerY + 9);

  doc.setFont(reportFont, "bold");
  doc.text(`Meeting Day:`, 210, headerY + 3);
  doc.setFont(reportFont, "normal");
  doc.text(`${dayName}`, 235, headerY + 3);

  doc.setFont(reportFont, "bold");
  doc.text(`Meeting Date:`, 210, headerY + 9);
  doc.setFont(reportFont, "normal");
  doc.text(`${formattedDate}`, 235, headerY + 9);

  const tableData = rows.map((entry, index) => [
    index + 1,
    entry.centerName,
    entry.phone || "-",
    entry.noOfClients,
    entry.wb,
    entry.dueNo,
    formatTime(entry.meetingTime),
    formatCurrency(entry.loanOS),
    formatCurrency(entry.arrear),
    formatCurrency(entry.demand),
    ...(loanAdvanceEnabled ? [formatCurrency(entry.loanAdvanceOS), formatCurrency(entry.savingsDemand)] : []),
    formatCurrency(entry.collected),
    "", // Signature
  ]);

  // Add Totals Row
  tableData.push([
    "",
    "GRAND TOTAL",
    "",
    totalClients,
    totalWB,
    rows.reduce((sum, e) => sum + e.dueNo, 0),
    "",
    formatCurrency(totalLoanOS),
    formatCurrency(totalArrear),
    formatCurrency(totalDemand),
    ...(loanAdvanceEnabled ? [
      formatCurrency(rows.reduce((s, e) => s + e.loanAdvanceOS, 0)),
      formatCurrency(rows.reduce((s, e) => s + e.savingsDemand, 0)),
    ] : []),
    formatCurrency(totalCollected),
    "",
  ]);

  // Column metadata in table order — the two `advanceOnly` entries (Loan Advance
  // OS / Loan.AD Demand) are dropped together with the matching `tableData`
  // cells above when the feature is disabled, keeping head/body/columnStyles
  // indices in sync.
  type ColMeta = { label: string; width: number; halign: "left" | "center" | "right"; advanceOnly?: boolean };
  const rawColumnMeta: ColMeta[] = [
    { label: "Sl No", width: 10, halign: "center" },
    { label: "Center Name", width: 50, halign: "left" },
    { label: "Phone", width: 25, halign: "center" },
    { label: "Clients", width: 15, halign: "center" },
    { label: "WB", width: 10, halign: "center" },
    { label: "Due No", width: 15, halign: "center" },
    { label: "Time", width: 20, halign: "center" },
    { label: "Loan OS", width: 25, halign: "right" },
    { label: "Arrear", width: 25, halign: "right" },
    { label: "Demand", width: 25, halign: "right" },
    { label: "Loan Advance OS", width: 25, halign: "right", advanceOnly: true },
    { label: "Loan.AD Demand", width: 25, halign: "right", advanceOnly: true },
    { label: "Collected", width: 25, halign: "right" },
    { label: "Signature", width: 25, halign: "left" },
  ];
  const columnMeta = rawColumnMeta.filter((c) => loanAdvanceEnabled || !c.advanceOnly);

  const columnStyles: Record<number, { cellWidth: number; halign: "left" | "center" | "right" }> = {};
  columnMeta.forEach((c, i) => {
    columnStyles[i] = { cellWidth: c.width, halign: c.halign };
  });

  autoTable(doc, {
    startY: headerY + 16,
    head: [columnMeta.map((c) => c.label)],
    body: tableData,
    theme: "striped",
    headStyles: {
      font: reportFont,
      fillColor: [15, 23, 42],
      textColor: 255,
      fontSize: 9,
      fontStyle: "bold",
      halign: "center",
      cellPadding: 4,
    },
    bodyStyles: { font: reportFont, fontSize: 8, textColor: [30, 41, 59], cellPadding: 3 },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles,
    didDrawPage: (data) => {
      const totalPages = doc.getNumberOfPages();
      if (data.pageNumber === totalPages) {
        const finalY = (data as unknown as { cursor: { y: number } }).cursor.y + 25;
        if (finalY > 180) doc.addPage();

        const signatureY = finalY > 180 ? 40 : finalY;

        doc.setDrawColor(200, 200, 200);
        doc.line(30, signatureY, 80, signatureY);
        doc.setFont(reportFont, "bold");
        doc.text("BM SIGNATURE", 55, signatureY + 5, { align: "center" });

        doc.line(210, signatureY, 260, signatureY);
        doc.text("AM SIGNATURE", 235, signatureY + 5, { align: "center" });
      }
    },
  });
}
