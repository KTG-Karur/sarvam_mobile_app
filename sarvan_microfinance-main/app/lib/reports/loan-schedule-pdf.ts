import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { getDocBrandPrimaryRgb } from "@/app/lib/reports/pdf-brand-color";
import { drawPdfReportHeader } from "@/app/lib/reports/pdf-report-header";
import { toDisplayDate } from '@/app/lib/date-format';

/** Signature shared with the other migrated reports' PdfHeaderDrawer — lets a server caller
 * (no window/DOM) inject its own Node-safe logo/font loading in place of the browser-only
 * drawPdfReportHeader default. */
export type PdfHeaderDrawer = (
  doc: jsPDF,
  title: string,
  opts?: { subtitle?: string; fontFamily?: string }
) => Promise<number>;

export interface LoanScheduleInstallmentRow {
  installmentNo: number;
  dueDate: string;
  principal: string;
  interest: string;
  savingsDue?: string;
  savingsPaid?: string;
  totalDue: string;
  balance: string;
}

export interface LoanScheduleDetails {
  clientName: string;
  clientId: string;
  loanNumber: string;
  centerName: string;
  amount: number;
  interestRate: number;
  tenure: number;
  frequency: string;
  disbursedDate: string | null;
  loanEndDate?: string | null;
}

const formatDateTime = (iso: string) => {
  if (!iso) return "";
  try {
    return toDisplayDate(new Date(iso));
  } catch {
    return iso;
  }
};

/**
 * Draws the (single-loan) Repayment Schedule report — trust header, then
 * one flat A4-landscape table whose body mixes a 6-row client/loan info
 * block (label/value pairs across 4 of the 8 schedule columns), a blank
 * spacer row, the installment schedule rows, and a trailing "Grand Total"
 * row — extracted verbatim from the Direct Download PDF logic in
 * components/reports/LoanScheduleReport.tsx's handleDownloadPDF /
 * buildScheduleExportRows, so the exact same rendering can be reused by
 * the Request Report queue's PDF builder (via an injected Node-safe
 * `drawHeader`) without duplicating the table logic. `drawHeader` defaults
 * to the browser drawPdfReportHeader, so the existing Direct caller is
 * unaffected by this extraction. Bespoke per-loan document, not a
 * multi-record report — one PDF per loanId, no batching.
 */
export async function drawLoanScheduleReport(
  doc: jsPDF,
  loanDetails: LoanScheduleDetails,
  schedule: LoanScheduleInstallmentRow[],
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader,
  loanAdvanceEnabled: boolean = true
): Promise<void> {
  const headers = [
    "No.", "Due Date", "Principal", "Interest",
    ...(loanAdvanceEnabled ? ["Loan Advance Due", "Loan Advance Paid"] : []),
    "Total Due", "Balance",
  ];
  const pad = Array(headers.length - 4).fill("");

  const scheduleRows: (string | number)[][] = schedule.map((row) => [
    row.installmentNo, formatDateTime(row.dueDate), parseFloat(row.principal), parseFloat(row.interest),
    ...(loanAdvanceEnabled ? [parseFloat(row.savingsDue || "0"), parseFloat(row.savingsPaid || "0")] : []),
    parseFloat(row.totalDue), parseFloat(row.balance),
  ]);
  if (schedule.length > 0) {
    const totPri = schedule.reduce((sum, r) => sum + parseFloat(r.principal || "0"), 0);
    const totInt = schedule.reduce((sum, r) => sum + parseFloat(r.interest || "0"), 0);
    const totDue = schedule.reduce((sum, r) => sum + parseFloat(r.savingsDue || "0"), 0);
    const totPaid = schedule.reduce((sum, r) => sum + parseFloat(r.savingsPaid || "0"), 0);
    const totTotal = schedule.reduce((sum, r) => sum + parseFloat(r.totalDue || "0"), 0);
    scheduleRows.push([
      "Grand Total", "", totPri, totInt,
      ...(loanAdvanceEnabled ? [totDue, totPaid] : []),
      totTotal, 0,
    ]);
  }

  const rows: (string | number)[][] = [
    ["Client Name", loanDetails.clientName, "Client ID", loanDetails.clientId, ...pad],
    ["Loan Account", loanDetails.loanNumber, "Center", loanDetails.centerName, ...pad],
    ["Loan Amount", loanDetails.amount, "Interest Rate", `${loanDetails.interestRate}%`, ...pad],
    ["Tenure", `${loanDetails.tenure} Months`, "Frequency", loanDetails.frequency, ...pad],
    ["Disbursement Date", formatDateTime(loanDetails.disbursedDate || ""), "Loan End Date", loanDetails.loanEndDate || "N/A", ...pad],
    ["", "", "", "", ...pad],
    ...scheduleRows,
  ];

  const headerY = await drawHeader(doc, "REPAYMENT SCHEDULE", {
    subtitle: `${loanDetails.clientName} — ${loanDetails.loanNumber}`,
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
