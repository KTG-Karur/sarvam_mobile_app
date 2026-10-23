import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { drawPdfReportHeader } from "@/app/lib/reports/pdf-report-header";
import { formatReportAmount } from "@/app/lib/utils/format-amount";

/** Signature shared with gl-all-pdf.ts's PdfHeaderDrawer / demand-sheet-centerwise-pdf.ts's
 * DemandSheetHeaderDrawer — lets a server caller (no window/DOM) inject its own Node-safe
 * logo/font loading in place of the browser-only drawPdfReportHeader default. */
export type PdfHeaderDrawer = (
  doc: jsPDF,
  title: string,
  opts?: { subtitle?: string; fontFamily?: string }
) => Promise<number>;

export interface GlAccountLedgerTransaction {
  date: string;
  type: "OB" | "CR" | "DR";
  particulars: string;
  description?: string;
  debit: number;
  credit: number;
  balance: number;
}

export interface GlAccountLedgerReportData {
  accountName: string;
  openingBalance: number;
  closingBalance: number;
  transactions: GlAccountLedgerTransaction[];
}

export interface GlAccountLedgerPdfMeta {
  /** e.g. "01 Jan 2026 to 31 Jan 2026" — matches the Direct page's subtitle exactly
   * (no "Period:" label prefix, unlike gl-all's). */
  periodLabel: string;
}

// Local copy of the Direct page's own formatCurrency — kept private to this file so
// page.tsx's own copy (still used by its on-screen table/summary cards) is untouched.
function formatCurrency(amount: number): string {
  return `₹${formatReportAmount(Math.abs(amount))}`;
}

/**
 * Draws the GL Account Ledger ("GL One") report — trust header, then a single
 * table with an Opening Balance row, one row per transaction, and a Closing
 * Balance row — extracted verbatim from the Direct Download PDF logic in
 * app/dashboard/admin-reports/account/gl-one/page.tsx's handleExportPDF, so the
 * exact same rendering can be reused by the Request Report queue's PDF builder
 * (via an injected Node-safe `drawHeader`) without duplicating the table/column
 * logic. `drawHeader` defaults to the browser drawPdfReportHeader, so the
 * existing Direct caller is unaffected by this extraction.
 */
export async function drawGlAccountLedgerReport(
  doc: jsPDF,
  reportData: GlAccountLedgerReportData,
  meta: GlAccountLedgerPdfMeta,
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const headerY = await drawHeader(doc, `LEDGER: ${reportData.accountName}`, {
    subtitle: meta.periodLabel,
    fontFamily: reportFont,
  });

  const rows = [];
  // Opening
  rows.push([
    "",
    "",
    "Opening Balance",
    reportData.openingBalance > 0 ? formatCurrency(reportData.openingBalance) : "-",
    reportData.openingBalance < 0 ? formatCurrency(Math.abs(reportData.openingBalance)) : "-",
    formatCurrency(reportData.openingBalance),
  ]);

  // Rows
  reportData.transactions.forEach((tx) => {
    rows.push([
      tx.date,
      tx.type,
      tx.particulars,
      tx.debit > 0 ? formatCurrency(tx.debit) : "-",
      tx.credit > 0 ? formatCurrency(tx.credit) : "-",
      formatCurrency(tx.balance),
    ]);
  });

  // Closing
  rows.push([
    "",
    "",
    "Closing Balance",
    reportData.closingBalance > 0 ? formatCurrency(reportData.closingBalance) : "-",
    reportData.closingBalance < 0 ? formatCurrency(Math.abs(reportData.closingBalance)) : "-",
    formatCurrency(reportData.closingBalance),
  ]);

  autoTable(doc, {
    startY: headerY,
    head: [["Date", "Type", "Particulars", "Debit", "Credit", "Balance"]],
    body: rows,
    headStyles: { font: reportFont },
    styles: { font: reportFont },
  });
}
