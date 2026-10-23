import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { drawPdfReportHeader } from "@/app/lib/reports/pdf-report-header";
import { formatReportAmount } from "@/app/lib/utils/format-amount";

/** Signature shared with the other migrated reports' PdfHeaderDrawer — lets a server caller
 * (no window/DOM) inject its own Node-safe logo/font loading in place of the browser-only
 * drawPdfReportHeader default. */
export type PdfHeaderDrawer = (
  doc: jsPDF,
  title: string,
  opts?: { subtitle?: string; fontFamily?: string }
) => Promise<number>;

export interface LoanLedgerDuesRow {
  dueNo: number;
  dueDate: string | null;
  collectionDate: string | null;
  duePrincipal: number;
  dueInterest: number;
  dueAmount: number;
  dueSavings: number;
  collectedPrincipal: number;
  collectedInterest: number;
  collectedPenalty: number;
  collectedAmount: number;
  collectedSavings: number;
  dueBalance: number;
  arrearTotal: number;
  collectedByName: string | null;
}

export interface LoanLedgerDuesData {
  header: {
    centerLabel: string;
    clientId: string;
    clientName: string;
    loanAccount: string;
    loanAmount: number;
    disbursalDate: string | null;
    loanEndDate?: string | null;
    totalDues: number;
    interestAmount: number;
    totalAmount: number;
    groupOfficerName?: string | null;
    funderName?: string | null;
  };
  rows: LoanLedgerDuesRow[];
  totals: {
    duePrincipal: number;
    dueInterest: number;
    dueAmount: number;
    dueSavings: number;
    collectedPrincipal: number;
    collectedInterest: number;
    collectedAmount: number;
    collectedSavings: number;
    dueBalance: number;
  };
}

// Format date as "DD-MM-YYYY hh:mm A" — matches the Direct page's own formatDateTime exactly.
function formatDateTime(dateString: string | null | undefined): string {
  if (!dateString) return "";
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const ampm = date.getHours() >= 12 ? "PM" : "AM";
    return `${day}/${month}/${year} ${hours}:${minutes} ${ampm}`;
  } catch {
    return dateString;
  }
}

const formatLegacyNumber = (amount: number): string => formatReportAmount(amount);

/**
 * Draws the Loan Dues Ledger report — trust header, a manual two-column
 * key-value header block (client/loan/center metadata via plain `doc.text()`
 * calls, not autoTable), then a single 20-column flat table with a trailing
 * Total row — extracted verbatim from the Direct Download PDF logic in
 * components/reports/LoanLedgerReport.tsx's handlePdfExport, so the exact
 * same rendering can be reused by the Request Report queue's PDF builder (via
 * an injected Node-safe `drawHeader`) without duplicating the drawing logic.
 * `drawHeader` defaults to the browser drawPdfReportHeader, so the existing
 * Direct caller is unaffected by this extraction.
 */
export async function drawLoanLedgerReport(
  doc: jsPDF,
  duesData: LoanLedgerDuesData,
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader,
  loanAdvanceEnabled: boolean = true
): Promise<void> {
  const headerY = await drawHeader(doc, "Loan Dues Ledger", {
    subtitle: duesData.header.centerLabel,
    fontFamily: reportFont,
  });

  // Two-column header block (legacy layout)
  doc.setFontSize(9);
  doc.setFont(reportFont, "normal");
  const leftX = 15;
  const rightX = 120;
  const row1Y = headerY + 5;
  const rowGap = 6;

  doc.text("Client ID", leftX, row1Y);
  doc.text(duesData.header.clientId, leftX + 30, row1Y);
  doc.text("Loan Account", rightX, row1Y);
  doc.text(duesData.header.loanAccount, rightX + 35, row1Y);

  doc.text("Client Name", leftX, row1Y + rowGap);
  doc.text(duesData.header.clientName, leftX + 30, row1Y + rowGap);
  doc.text("Total Dues", rightX, row1Y + rowGap);
  doc.text(String(duesData.header.totalDues), rightX + 35, row1Y + rowGap);

  doc.text("Disbursal Date", leftX, row1Y + rowGap * 2);
  doc.text(duesData.header.disbursalDate ?? "", leftX + 30, row1Y + rowGap * 2);
  doc.text("Loan End Date", rightX - 20, row1Y + rowGap * 2);
  doc.text(duesData.header.loanEndDate ?? "N/A", rightX + 35, row1Y + rowGap * 2);
  doc.text("Loan Amount", rightX, row1Y + rowGap * 2);
  doc.text(formatLegacyNumber(duesData.header.loanAmount), rightX + 35, row1Y + rowGap * 2);

  doc.text("Interest Amount", leftX, row1Y + rowGap * 3);
  doc.text(formatLegacyNumber(duesData.header.interestAmount), leftX + 30, row1Y + rowGap * 3);
  doc.text("Total Amount", rightX, row1Y + rowGap * 3);
  doc.text(formatLegacyNumber(duesData.header.totalAmount), rightX + 35, row1Y + rowGap * 3);

  const tableData = duesData.rows.map((r) => [
    String(r.dueNo),
    formatDateTime(r.dueDate),
    formatDateTime(r.collectionDate),
    formatLegacyNumber(r.duePrincipal),
    formatLegacyNumber(r.dueInterest),
    formatLegacyNumber(r.dueAmount),
    ...(loanAdvanceEnabled ? [formatLegacyNumber(r.dueSavings)] : []),
    formatLegacyNumber(r.collectedPrincipal),
    formatLegacyNumber(r.collectedInterest),
    formatLegacyNumber(r.collectedAmount),
    ...(loanAdvanceEnabled ? [formatLegacyNumber(r.collectedSavings)] : []),
    formatLegacyNumber(r.dueBalance),
    formatLegacyNumber(r.arrearTotal),
    formatLegacyNumber(0),
    formatLegacyNumber(0),
    formatLegacyNumber(r.collectedPenalty),
    duesData.header.groupOfficerName ?? "",
    r.collectedByName ?? "",
    duesData.header.funderName ?? "",
    formatLegacyNumber(r.arrearTotal),
  ]);
  tableData.push([
    "Total", "", "",
    formatLegacyNumber(duesData.totals.duePrincipal),
    formatLegacyNumber(duesData.totals.dueInterest),
    formatLegacyNumber(duesData.totals.dueAmount),
    ...(loanAdvanceEnabled ? [formatLegacyNumber(duesData.totals.dueSavings)] : []),
    formatLegacyNumber(duesData.totals.collectedPrincipal),
    formatLegacyNumber(duesData.totals.collectedInterest),
    formatLegacyNumber(duesData.totals.collectedAmount),
    ...(loanAdvanceEnabled ? [formatLegacyNumber(duesData.totals.collectedSavings)] : []),
    formatLegacyNumber(duesData.totals.dueBalance),
    "", "", "", "", "", "", "", "",
  ]);

  // Column metadata in table order — the two `advanceOnly` entries (Loan Adv Due /
  // Loan Adv Coll) are dropped together with the matching `tableData` cells above
  // when the feature is disabled, keeping head/body/columnStyles indices in sync.
  type ColMeta = { label: string; width: number; halign: "left" | "center" | "right"; advanceOnly?: boolean };
  const rawColumnMeta: ColMeta[] = [
    { label: "Due No", width: 10, halign: "center" },
    { label: "Due Date", width: 15, halign: "center" },
    { label: "Coll Date", width: 15, halign: "center" },
    { label: "Due Pri\nAmt", width: 14, halign: "right" },
    { label: "Due Int\nAmt", width: 14, halign: "right" },
    { label: "Due\nAmt", width: 14, halign: "right" },
    { label: "Loan\nAdv Due", width: 13, halign: "right", advanceOnly: true },
    { label: "Coll Pri", width: 14, halign: "right" },
    { label: "Coll Int", width: 14, halign: "right" },
    { label: "Coll\nAmt", width: 14, halign: "right" },
    { label: "Loan\nAdv Coll", width: 13, halign: "right", advanceOnly: true },
    { label: "Due\nBalance", width: 15, halign: "right" },
    { label: "Arrear\nAmt", width: 14, halign: "right" },
    { label: "Penalty\nPri", width: 12, halign: "right" },
    { label: "Penalty\nInt", width: 12, halign: "right" },
    { label: "Penalty\nTotal", width: 14, halign: "right" },
    { label: "Group\nOfficer", width: 16, halign: "center" },
    { label: "Collected\nBy", width: 16, halign: "center" },
    { label: "Funder", width: 14, halign: "center" },
    { label: "Arrear\nReceive", width: 14, halign: "right" },
  ];
  const columnMeta = rawColumnMeta.filter((c) => loanAdvanceEnabled || !c.advanceOnly);

  const columnStyles: Record<number, { cellWidth: number; halign: "left" | "center" | "right" }> = {};
  columnMeta.forEach((c, i) => {
    columnStyles[i] = { cellWidth: c.width, halign: c.halign };
  });

  autoTable(doc, {
    startY: row1Y + rowGap * 3 + 10,
    head: [columnMeta.map((c) => c.label)],
    body: tableData,
    theme: "grid",
    headStyles: {
      fillColor: [30, 41, 59],
      textColor: 255,
      fontSize: 7,
      halign: "center",
      font: reportFont,
    },
    bodyStyles: { fontSize: 7, font: reportFont },
    columnStyles,
  });
}
