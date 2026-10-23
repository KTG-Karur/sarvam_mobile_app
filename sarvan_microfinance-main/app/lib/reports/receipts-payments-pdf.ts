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

export interface ReceiptsPaymentsEntry {
  id?: string;
  ledgerName: string;
  amount: number;
}

export interface ReceiptsPaymentsReportData {
  receipts: ReceiptsPaymentsEntry[];
  payments: ReceiptsPaymentsEntry[];
  openingBalance: number;
  closingBalance: number;
  totalReceipts: number;
  totalPayments: number;
}

export interface ReceiptsPaymentsPdfMeta {
  /** e.g. "CONSOLIDATED  •  PERIOD: 01 JAN 2026 TO 31 JAN 2026" — matches the Direct page's
   * subtitle exactly. */
  subtitle: string;
}

function formatCurrency(amount: number): string {
  return formatReportAmount(amount);
}

/**
 * Draws the Receipts & Payments report — trust header, then two genuinely
 * side-by-side `autoTable` calls (Receipts on the left half, Payments on the
 * right half, split via explicit margin.left/margin.right on each call) plus a
 * dashed outer border rect — extracted verbatim from the Direct Download PDF
 * logic in app/dashboard/admin-reports/account/receipts-payments/page.tsx's
 * handleExportPDF, so the exact same rendering can be reused by the Request
 * Report queue's PDF builder (via an injected Node-safe `drawHeader`) without
 * duplicating the table logic. `drawHeader` defaults to the browser
 * drawPdfReportHeader, so the existing Direct caller is unaffected by this
 * extraction.
 */
export async function drawReceiptsPaymentsReport(
  doc: jsPDF,
  data: ReceiptsPaymentsReportData,
  meta: ReceiptsPaymentsPdfMeta,
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const headerY = await drawHeader(doc, "RECEIPTS AND PAYMENTS REPORT", {
    subtitle: meta.subtitle,
    fontFamily: reportFont,
  });

  const receiptsContent = [...(data.receipts || [])];
  receiptsContent.unshift({ id: "opening", ledgerName: "OPENING BALANCE:", amount: data.openingBalance });

  const paymentsContent = [...(data.payments || [])];
  paymentsContent.push({ id: "closing", ledgerName: "CLOSING BALANCE:", amount: data.closingBalance });

  const grandTotalReceipts = (data.openingBalance || 0) + (data.totalReceipts || 0);
  const grandTotalPayments = (data.totalPayments || 0) + (data.closingBalance || 0);

  const rBody = receiptsContent.map((r) => [
    { content: r ? r.ledgerName : "", styles: r?.id === "opening" ? { fontStyle: "bold" as const } : {} },
    {
      content: r ? `₹ ${formatCurrency(r.amount)}` : "",
      styles: { halign: "right" as const, fontStyle: r?.id === "opening" ? ("bold" as const) : ("normal" as const) },
    },
  ]);

  rBody.push([
    { content: "TOTAL RECEIPTS", styles: { fontStyle: "bold" as const, halign: "right" as const } },
    { content: `₹ ${formatCurrency(grandTotalReceipts)}`, styles: { halign: "right" as const, fontStyle: "bold" as const } },
  ]);

  const pBody = paymentsContent.map((p) => [
    { content: p ? p.ledgerName : "", styles: p?.id === "closing" ? { fontStyle: "bold" as const } : {} },
    {
      content: p ? `₹ ${formatCurrency(p.amount)}` : "",
      styles: { halign: "right" as const, fontStyle: p?.id === "closing" ? ("bold" as const) : ("normal" as const) },
    },
  ]);

  pBody.push([
    { content: "TOTAL PAYMENTS", styles: { fontStyle: "bold" as const, halign: "right" as const } },
    { content: `₹ ${formatCurrency(grandTotalPayments)}`, styles: { halign: "right" as const, fontStyle: "bold" as const } },
  ]);

  const pageWidth = doc.internal.pageSize.width;
  const margin = 14;
  const gap = 4;
  const halfWidth = (pageWidth - margin * 2 - gap) / 2;

  const commonStyles = {
    theme: "grid" as const,
    startY: headerY,
    headStyles: {
      fillColor: [255, 255, 255] as [number, number, number],
      textColor: [0, 0, 0] as [number, number, number],
      lineColor: [0, 0, 0] as [number, number, number],
      lineWidth: 0.2,
    },
    bodyStyles: {
      fillColor: [255, 255, 255] as [number, number, number],
      textColor: [0, 0, 0] as [number, number, number],
      lineColor: [0, 0, 0] as [number, number, number],
      lineWidth: 0.2,
    },
    styles: { fontSize: 8, cellPadding: 1.5, font: reportFont },
  };

  doc.setDrawColor(0);
  doc.setLineDashPattern([1, 1], 0);
  doc.rect(margin - 2, headerY - 2, pageWidth - margin * 2 + 4, doc.internal.pageSize.height - (headerY + 5));
  doc.setLineDashPattern([], 0);

  autoTable(doc, {
    ...commonStyles,
    margin: { left: margin, right: margin + halfWidth + gap },
    head: [
      [{ content: "RECEIPTS", colSpan: 2, styles: { halign: "center" as const, fontStyle: "bold" as const } }],
      [
        { content: "Ledger Name", styles: { halign: "center" as const, fontStyle: "bold" as const, cellWidth: halfWidth - 30 } },
        { content: "Closing", styles: { halign: "center" as const, fontStyle: "bold" as const, cellWidth: 30 } },
      ],
    ],
    body: rBody,
  });

  autoTable(doc, {
    ...commonStyles,
    margin: { left: margin + halfWidth + gap, right: margin },
    head: [
      [{ content: "PAYMENTS", colSpan: 2, styles: { halign: "center" as const, fontStyle: "bold" as const } }],
      [
        { content: "Ledger Name", styles: { halign: "center" as const, fontStyle: "bold" as const, cellWidth: halfWidth - 30 } },
        { content: "Closing", styles: { halign: "center" as const, fontStyle: "bold" as const, cellWidth: 30 } },
      ],
    ],
    body: pBody,
  });
}
