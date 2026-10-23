import { jsPDF } from "jspdf";
import autoTable, { type CellDef } from "jspdf-autotable";
import type { DemandClientWiseReportData } from "@/app/lib/actions/demand";
import { drawPdfReportHeader } from "@/app/lib/reports/pdf-report-header";
import { ensureReportFont } from "@/app/lib/reports/pdf-fonts";
import { normalizeMeetingTime } from "@/app/lib/utils/meeting-time";
import { formatReportAmount } from "@/app/lib/utils/format-amount";

/**
 * Formatting helpers + PDF-drawing logic for a single center's Client Wise
 * Demand Sheet ("Detailed report") — extracted verbatim from
 * components/reports/ClientWiseDemandReportDialog.tsx so the exact same
 * per-center structure (table + denomination + signatures) can be reused by
 * both the single-center dialog (unchanged behavior) and the "Download All
 * Centers" preview (one of these blocks repeated per center).
 */

export function formatAmount(value: number): string {
  if (!value || value === 0) return "";
  return formatReportAmount(value);
}

export function formatArrearAmount(value: number): string {
  if (!value || value === 0) return "0";
  return formatAmount(value);
}

export function formatDateToDDMMYY(dateString: string): string {
  if (!dateString || dateString === "" || dateString === "null" || dateString === "undefined") {
    return "";
  }
  try {
    // Already a display date (dd/MM/yyyy, or legacy dd-MM-yyyy) — never re-parse it:
    // new Date('01/10/2026') would read it as January 10.
    if (/^\d{2}[-/]\d{2}[-/]\d{4}$/.test(dateString)) {
      const [day, month, year] = dateString.split(/[-/]/);
      return `${day}/${month}/${year}`;
    }
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    const day = date.getDate().toString().padStart(2, "0");
    const month = (date.getMonth() + 1).toString().padStart(2, "0");
    const year = date.getFullYear().toString();
    return `${day}/${month}/${year}`;
  } catch {
    return dateString;
  }
}

type DocWithAutoTable = jsPDF & { lastAutoTable?: { finalY: number } };

/** Signature shared with demand-sheet-centerwise-pdf.ts's DemandSheetHeaderDrawer —
 * lets a server caller (no window/DOM) inject its own Node-safe logo/font loading
 * in place of the browser-only drawPdfReportHeader default. */
export type DemandSheetHeaderDrawer = (
  doc: jsPDF,
  title: string,
  opts?: { subtitle?: string; fontFamily?: string }
) => Promise<number>;

/**
 * Draws one center's complete report (header info, client table, denomination
 * table, signatures) onto the CURRENT page of `doc`, starting immediately
 * after a fresh header draw. Does not create or save the document — callers
 * own that (single-center: create+save once; all-centers: create once, call
 * this per center with doc.addPage() between). `drawHeader` defaults to the
 * browser drawPdfReportHeader, so existing (page.tsx/dialog) callers that don't
 * pass it are completely unaffected.
 */
export async function drawClientWiseCenterReportPage(
  doc: jsPDF,
  report: DemandClientWiseReportData,
  dateStr: string,
  reportFont: string,
  drawHeader: DemandSheetHeaderDrawer = drawPdfReportHeader,
  loanAdvanceEnabled: boolean = true
): Promise<void> {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 8;

  let y = await drawHeader(doc, "Client Wise Demand Sheet", { fontFamily: reportFont });

  doc.setFontSize(8.5);
  doc.setFont(reportFont, "normal");
  doc.setTextColor(0, 0, 0);

  const leftX = margin;
  const rightX = pageWidth - margin;

  // Row 1
  doc.setFont(reportFont, "normal");
  doc.text(`Branch : ${report.branchCode} - ${report.branchName}`, leftX, y);
  doc.text(`Meeting Time : ${report.meetingTime ? normalizeMeetingTime(report.meetingTime) : "-"}`, rightX, y, { align: "right" });
  y += 5;

  // Row 2
  doc.text(`Center : ${report.centerCode} - ${report.centerName}`, leftX, y);
  doc.text(`Meeting Day : ${report.meetingDay}`, rightX, y, { align: "right" });
  y += 5;

  // Row 3
  doc.text(`FDO : ${report.fdoName || "-"}`, leftX, y);
  doc.text(`Meeting Date : ${formatDateToDDMMYY(report.meetingDate)}`, rightX, y, { align: "right" });
  y += 6;

  // Simplified 16-column layout: ID, Member Name, Member Phone, Loan Amount,
  // OS Amount (Pri/Int), Dues (Cur/Coll), Arrear OS, Current Demand
  // (Pri/Int/Total), Loan Advance (OS/Due), Total Demand Amount, Coll Amount.
  const clientRows = report.clients.map((row): (string | CellDef)[] => {
    return [
      row.clientId,
      row.clientName.toUpperCase().substring(0, 24),
      row.mobileNumber || "-",
      formatAmount(row.loanAmount),
      formatAmount(row.loanOSPrincipal),
      formatAmount(row.loanOSInterest),
      String(row.currentDueNo || 0),
      String(row.collectionDueNo || 0),
      formatArrearAmount(row.arrear),
      formatAmount(row.currentDemandPrincipal),
      formatAmount(row.currentDemandInterest),
      formatAmount(row.currentDemand),
      ...(loanAdvanceEnabled ? [
        row.loanAdvanceOS > 0 ? formatAmount(row.loanAdvanceOS) : "",
        row.loanAdvanceDemand > 0 ? formatAmount(row.loanAdvanceDemand) : "",
      ] : []),
      formatAmount(row.totalDemandAmount),
      row.collectedIncludingSavings > 0 ? formatAmount(row.collectedIncludingSavings) : "",
    ];
  });

  const footerRow: (string | CellDef)[] = [
    { content: `Total : (${report.totalClients} clients)`, colSpan: 3 },
    formatAmount(report.grandTotalLoanAmount),
    formatAmount(report.grandTotalLoanOSPrincipal),
    formatAmount(report.grandTotalLoanOSInterest),
    String(report.clients.reduce((s, c) => s + (c.currentDueNo || 0), 0)),
    String(report.clients.reduce((s, c) => s + (c.collectionDueNo || 0), 0)),
    formatArrearAmount(report.grandTotalArrear),
    formatAmount(report.grandTotalCurrentDemandPrincipal),
    formatAmount(report.grandTotalCurrentDemandInterest),
    formatAmount(report.grandTotalCurrentDemand),
    ...(loanAdvanceEnabled ? [
      formatAmount(report.grandTotalLoanAdvanceOS),
      formatAmount(report.grandTotalLoanAdvanceDemand),
    ] : []),
    formatAmount(report.grandTotalDemandAmount),
    formatAmount(report.grandTotalCollectedIncludingSavings),
  ];

  autoTable(doc, {
    startY: y,
    head: [
      [
        { content: "ID", rowSpan: 2, styles: { fontSize: 7, fontStyle: "bold", halign: "center", valign: "middle" } },
        { content: "Member Name", rowSpan: 2, styles: { fontSize: 7, fontStyle: "bold", halign: "center", valign: "middle" } },
        { content: "Member Phone", rowSpan: 2, styles: { fontSize: 7, fontStyle: "bold", halign: "center", valign: "middle" } },
        { content: "Loan Amount", rowSpan: 2, styles: { fontSize: 7, fontStyle: "bold", halign: "center", valign: "middle" } },
        { content: "OS Amount", colSpan: 2, styles: { fontSize: 7, fontStyle: "bold", halign: "center" } },
        { content: "Dues", colSpan: 2, styles: { fontSize: 7, fontStyle: "bold", halign: "center" } },
        { content: "Arrear OS", rowSpan: 2, styles: { fontSize: 7, fontStyle: "bold", halign: "center", valign: "middle" } },
        { content: "Current Demand", colSpan: 3, styles: { fontSize: 7, fontStyle: "bold", halign: "center" } },
        ...(loanAdvanceEnabled ? [{ content: "Loan Advance", colSpan: 2, styles: { fontSize: 7, fontStyle: "bold" as const, halign: "center" as const } }] : []),
        { content: "Total Demand Amount", rowSpan: 2, styles: { fontSize: 7, fontStyle: "bold", halign: "center", valign: "middle" } },
        { content: "Coll Amount", rowSpan: 2, styles: { fontSize: 7, fontStyle: "bold", halign: "center", valign: "middle" } },
      ],
      [
        { content: "Pri", styles: { fontSize: 7, fontStyle: "bold", halign: "center" } },
        { content: "Int", styles: { fontSize: 7, fontStyle: "bold", halign: "center" } },
        { content: "Cur", styles: { fontSize: 7, fontStyle: "bold", halign: "center" } },
        { content: "Coll", styles: { fontSize: 7, fontStyle: "bold", halign: "center" } },
        { content: "Pri", styles: { fontSize: 7, fontStyle: "bold", halign: "center" } },
        { content: "Int", styles: { fontSize: 7, fontStyle: "bold", halign: "center" } },
        { content: "Total", styles: { fontSize: 7, fontStyle: "bold", halign: "center" } },
        ...(loanAdvanceEnabled ? [
          { content: "OS", styles: { fontSize: 7, fontStyle: "bold" as const, halign: "center" as const } },
          { content: "Due", styles: { fontSize: 7, fontStyle: "bold" as const, halign: "center" as const } },
        ] : []),
      ],
    ],
    body: clientRows,
    foot: [footerRow],
    theme: "grid",
    styles: { font: reportFont },
    headStyles: {
      font: reportFont,
      fillColor: [243, 244, 246] as [number, number, number],
      textColor: [17, 24, 39],
      fontSize: 7,
      fontStyle: "bold",
      halign: "center",
      valign: "middle",
      lineColor: [0, 0, 0] as [number, number, number],
      lineWidth: 0.1,
    },
    bodyStyles: {
      fontSize: 6.5,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0] as [number, number, number],
      lineWidth: 0.1,
      cellPadding: 1.2,
    },
    footStyles: {
      fillColor: [249, 250, 251] as [number, number, number],
      textColor: [0, 0, 0],
      fontSize: 7,
      fontStyle: "bold",
      lineColor: [0, 0, 0] as [number, number, number],
      lineWidth: 0.1,
    },
    alternateRowStyles: {
      fillColor: [255, 255, 255] as [number, number, number]
    },
    columnStyles: (() => {
      type ColMeta = { width: number; halign: "left" | "center" | "right"; advanceOnly?: boolean };
      const rawMeta: ColMeta[] = [
        { width: 16, halign: "left" },      // ID
        { width: 32, halign: "left" },      // Member Name
        { width: 20, halign: "left" },      // Member Phone
        { width: 16, halign: "right" },     // Loan Amount
        { width: 15, halign: "right" },     // OS Pri
        { width: 15, halign: "right" },     // OS Int
        { width: 10, halign: "center" },    // Dues Cur
        { width: 10, halign: "center" },    // Dues Coll
        { width: 15, halign: "right" },     // Arrear OS
        { width: 15, halign: "right" },     // Current Demand Pri
        { width: 15, halign: "right" },     // Current Demand Int
        { width: 16, halign: "right" },     // Current Demand Total
        { width: 15, halign: "right", advanceOnly: true },     // Loan Advance OS
        { width: 15, halign: "right", advanceOnly: true },     // Loan Advance Due
        { width: 18, halign: "right" },     // Total Demand Amount
        { width: 18, halign: "right" },     // Coll Amount
      ];
      const meta = rawMeta.filter((c) => loanAdvanceEnabled || !c.advanceOnly);
      const styles: Record<number, { cellWidth: number; halign: "left" | "center" | "right" }> = {};
      meta.forEach((c, i) => { styles[i] = { cellWidth: c.width, halign: c.halign }; });
      return styles;
    })(),
    margin: { left: margin, right: margin },
    didParseCell: (data) => {
      if (data.section === 'body' && data.row.index !== undefined) {
        const row = report.clients[data.row.index];
        const loanAdvanceColIndex = loanAdvanceEnabled ? [12, 13] : [];
        if (row && (row.arrear || 0) > 0) {
          data.cell.styles.textColor = [220, 38, 38];
          data.cell.styles.fillColor = [254, 242, 242];
          data.cell.styles.fontStyle = 'bold';
        } else if (loanAdvanceColIndex.includes(data.column.index)) {
          data.cell.styles.textColor = [4, 120, 87];
        }
      }
    },
  });

  const finalY = (doc as DocWithAutoTable).lastAutoTable?.finalY ?? y + 50;
  let currentY = finalY + 6;

  if (currentY + 65 > pageHeight) {
    doc.addPage();
    currentY = 15;
  }

  const tableStartX = margin;
  const denomTableWidth = 95;

  // Denomination Table matching UI structure
  const denomBody: (string | CellDef)[][] = [
    ["Rs.500", "", ""],
    ["Rs.200", "", ""],
    ["Rs.100", "", ""],
    ["Rs.50", "", ""],
    ["Rs.20", "", ""],
    ["Rs.10", "", ""],
    ["Coins", "", ""],
    ["UPI", "", ""],
    [{ content: "Total", styles: { fontStyle: "bold" } }, "", ""],
  ];

  autoTable(doc, {
    startY: currentY,
    margin: { left: tableStartX, right: pageWidth - tableStartX - denomTableWidth },
    tableWidth: denomTableWidth,
    head: [
      [
        { content: "DENOMINATION", styles: { halign: "center", fontStyle: "bold" } },
        { content: "COUNT", styles: { halign: "center", fontStyle: "bold" } },
        { content: "VALUE", styles: { halign: "center", fontStyle: "bold" } },
      ]
    ],
    body: denomBody,
    theme: "grid",
    styles: { font: reportFont },
    headStyles: {
      font: reportFont,
      fillColor: [243, 244, 246] as [number, number, number],
      textColor: [17, 24, 39],
      fontSize: 7,
      lineColor: [0, 0, 0] as [number, number, number],
      lineWidth: 0.1,
      cellPadding: 1.5,
    },
    bodyStyles: {
      fontSize: 6.5,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0] as [number, number, number],
      lineWidth: 0.1,
      cellPadding: 1.2,
    },
    footStyles: {
      fillColor: [249, 250, 251] as [number, number, number],
      textColor: [0, 0, 0],
      fontSize: 7,
      fontStyle: "bold",
      lineColor: [0, 0, 0] as [number, number, number],
      lineWidth: 0.1,
    },
    columnStyles: {
      0: { cellWidth: 35, halign: "left" },
      1: { cellWidth: 30, halign: "center" },
      2: { cellWidth: 30, halign: "center" },
    },
    didDrawCell: (data) => {
      if (data.section === 'body' && data.row.index === 8) {
        data.cell.styles.fillColor = [249, 250, 251];
        data.cell.styles.fontStyle = 'bold';
      }
    }
  });

  // Signatures section aligned to the right of Denomination table
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

/** Single-center convenience wrapper — creates the doc, loads the font, draws
 * one page, saves. Used by the per-center "Detailed report" dialog; identical
 * to the original inline buildDetailedReportPdf behavior/output. */
export async function buildClientWiseCenterReportPdf(
  report: DemandClientWiseReportData,
  dateStr: string,
  loanAdvanceEnabled: boolean = true
): Promise<void> {
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
  });
  const reportFont = await ensureReportFont(doc);
  await drawClientWiseCenterReportPage(doc, report, dateStr, reportFont, undefined, loanAdvanceEnabled);
  const safeCenter = report.centerCode.replace(/[^\w.-]+/g, "_");
  doc.save(`Demand_Sheet_${safeCenter}_${dateStr}.pdf`);
}

/** All-centers PDF — one document, one full center-report page per center,
 * each with its own denomination/signature block (never a single shared one). */
export async function buildClientWiseAllCentersPdf(
  reports: DemandClientWiseReportData[],
  dateStr: string,
  fileName: string,
  loanAdvanceEnabled: boolean = true
): Promise<void> {
  const doc = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
  });
  const reportFont = await ensureReportFont(doc);
  for (let i = 0; i < reports.length; i++) {
    if (i > 0) doc.addPage();
    await drawClientWiseCenterReportPage(doc, reports[i], dateStr, reportFont, undefined, loanAdvanceEnabled);
  }
  doc.save(fileName);
}

/** Flat-row headers matching drawClientWiseCenterReportPage's PDF table columns
 * (minus Signature, which has no meaning in a spreadsheet) — shared by Excel/CSV
 * builders so header/column order can't drift from the PDF/preview structure.
 * Kept as the full (loan-advance-enabled) shape for any caller that hasn't been
 * updated to pass the flag — prefer getClientWiseCenterExportHeaders() instead. */
export const CLIENT_WISE_CENTER_EXPORT_HEADERS = [
  "S.No", "Member ID", "Member Name", "Member Phone",
  "Loan Amount", "Loan OS Principal", "Loan OS Interest",
  "Cur Due", "Coll Due", "Arrear",
  "Current Demand Principal", "Current Demand Interest", "Current Demand Total",
  "Loan Advance OS", "Loan Advance Due", "Total Demand Amount", "Collected",
] as const;

export function getClientWiseCenterExportHeaders(loanAdvanceEnabled: boolean): string[] {
  return [
    "S.No", "Member ID", "Member Name", "Member Phone",
    "Loan Amount", "Loan OS Principal", "Loan OS Interest",
    "Cur Due", "Coll Due", "Arrear",
    "Current Demand Principal", "Current Demand Interest", "Current Demand Total",
    ...(loanAdvanceEnabled ? ["Loan Advance OS", "Loan Advance Due"] : []),
    "Total Demand Amount", "Collected",
  ];
}

/** One center's client rows + its own total row, in the same column shape as
 * getClientWiseCenterExportHeaders(loanAdvanceEnabled) — no denomination rows
 * (callers append those separately per center via buildDemandSheetDenominationRows). */
export function buildClientWiseCenterExportRows(
  report: DemandClientWiseReportData,
  loanAdvanceEnabled: boolean = true
): (string | number)[][] {
  const rows: (string | number)[][] = report.clients.map((r, index) => [
    index + 1,
    r.clientId,
    r.clientName,
    r.mobileNumber || "-",
    formatAmount(r.loanAmount),
    formatAmount(r.loanOSPrincipal),
    formatAmount(r.loanOSInterest),
    r.currentDueNo || 0,
    r.collectionDueNo || 0,
    formatArrearAmount(r.arrear),
    formatAmount(r.currentDemandPrincipal),
    formatAmount(r.currentDemandInterest),
    formatAmount(r.currentDemand),
    ...(loanAdvanceEnabled ? [
      r.loanAdvanceOS > 0 ? formatAmount(r.loanAdvanceOS) : "",
      r.loanAdvanceDemand > 0 ? formatAmount(r.loanAdvanceDemand) : "",
    ] : []),
    formatAmount(r.totalDemandAmount),
    r.collectedIncludingSavings > 0 ? formatAmount(r.collectedIncludingSavings) : "",
  ]);
  rows.push([
    "", "", `TOTAL (${report.totalClients} clients)`, "",
    formatAmount(report.grandTotalLoanAmount),
    formatAmount(report.grandTotalLoanOSPrincipal),
    formatAmount(report.grandTotalLoanOSInterest),
    report.clients.reduce((s, c) => s + (c.currentDueNo || 0), 0),
    report.clients.reduce((s, c) => s + (c.collectionDueNo || 0), 0),
    formatArrearAmount(report.grandTotalArrear),
    formatAmount(report.grandTotalCurrentDemandPrincipal),
    formatAmount(report.grandTotalCurrentDemandInterest),
    formatAmount(report.grandTotalCurrentDemand),
    ...(loanAdvanceEnabled ? [
      formatAmount(report.grandTotalLoanAdvanceOS),
      formatAmount(report.grandTotalLoanAdvanceDemand),
    ] : []),
    formatAmount(report.grandTotalDemandAmount),
    formatAmount(report.grandTotalCollectedIncludingSavings),
  ]);
  return rows;
}
