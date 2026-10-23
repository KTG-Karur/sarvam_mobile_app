import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { drawPdfReportHeader } from "@/app/lib/reports/pdf-report-header";
import { formatReportAmount } from "@/app/lib/utils/format-amount";

/** Signature shared with demand-sheet-centerwise-pdf.ts's DemandSheetHeaderDrawer /
 * client-wise-center-report.ts's DemandSheetHeaderDrawer — lets a server caller (no
 * window/DOM) inject its own Node-safe logo/font loading in place of the browser-only
 * drawPdfReportHeader default. */
export type PdfHeaderDrawer = (
  doc: jsPDF,
  title: string,
  opts?: { subtitle?: string; fontFamily?: string }
) => Promise<number>;

export interface GlAllTransaction {
  date: string;
  type: string;
  particulars: string;
  debit: number;
  credit: number;
  voucherNo: string;
}

export interface GlAllAccount {
  id: string;
  name: string;
  type: "LEDGER" | "SELF";
  openingBalance: number;
  closingBalance: number;
  transactions: GlAllTransaction[];
}

export interface GlAllPdfMeta {
  /** e.g. "HEAD OFFICE" | "CONSOLIDATED" — matches REPORT_TYPES' `name` on the Direct page. */
  reportTypeLabel: string;
  /** e.g. "Period: 01 Jan 2026 to 31 Jan 2026" — matches the Direct page's subtitle exactly. */
  periodLabel: string;
}

/**
 * Draws the General Ledger - All Accounts report (trust header, then one
 * title-bar + table section per account, with manual page-break checks) onto
 * `doc` — extracted verbatim from the Direct Download PDF logic in
 * app/dashboard/admin-reports/account/gl-all/page.tsx's handleExportPDF, so the
 * exact same rendering can be reused by the Request Report queue's PDF builder
 * (via an injected Node-safe `drawHeader`) without duplicating the per-account
 * table/column logic. `drawHeader` defaults to the browser drawPdfReportHeader,
 * so the existing Direct caller is unaffected by this extraction.
 */
export async function drawGlAllReport(
  doc: jsPDF,
  accounts: GlAllAccount[],
  meta: GlAllPdfMeta,
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  let yPos = await drawHeader(doc, `GENERAL LEDGER REPORT (${meta.reportTypeLabel})`, {
    subtitle: meta.periodLabel,
    fontFamily: reportFont,
  });

  accounts.forEach((acc) => {
    // Check page break
    if (yPos > 250) {
      doc.addPage();
      yPos = 20;
    }

    // Account Title
    doc.setFontSize(11);
    doc.setFont(reportFont, "bold");
    doc.setFillColor(240, 240, 240);
    doc.rect(14, yPos, 182, 8, "F");
    doc.text(acc.name, 16, yPos + 6);
    yPos += 10;

    const tableRows = [];

    // Opening Balance
    tableRows.push([
      "",
      "",
      "",
      "Opening Balance",
      acc.openingBalance > 0 ? formatReportAmount(acc.openingBalance) : "",
      acc.openingBalance < 0 ? formatReportAmount(Math.abs(acc.openingBalance)) : "",
    ]);

    // Transactions
    acc.transactions.forEach((tx) => {
      tableRows.push([
        tx.date,
        tx.type,
        tx.voucherNo,
        tx.particulars,
        tx.debit > 0 ? formatReportAmount(tx.debit) : "",
        tx.credit > 0 ? formatReportAmount(tx.credit) : "",
      ]);
    });

    // Closing Balance
    tableRows.push([
      { content: "Closing Balance", colSpan: 4, styles: { fontStyle: "bold", halign: "right" } },
      { content: acc.closingBalance > 0 ? formatReportAmount(acc.closingBalance) : "", styles: { fontStyle: "bold" } },
      { content: acc.closingBalance < 0 ? formatReportAmount(Math.abs(acc.closingBalance)) : "", styles: { fontStyle: "bold" } },
    ]);

    autoTable(doc, {
      startY: yPos,
      head: [["Date", "Type", "Vch No", "Particulars", "Debit", "Credit"]],
      body: tableRows as any,
      theme: "grid",
      styles: { font: reportFont, fontSize: 8 },
      headStyles: { font: reportFont },
      columnStyles: {
        4: { halign: "right" },
        5: { halign: "right" },
      },
      margin: { top: 20 },
    });

    yPos = (doc as any).lastAutoTable.finalY + 10;
  });
}
