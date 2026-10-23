import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { getDocBrandPrimaryRgb } from "@/app/lib/reports/pdf-brand-color";
import { drawPdfReportHeader } from "@/app/lib/reports/pdf-report-header";

/** Signature shared with the other migrated reports' PdfHeaderDrawer — lets a server caller
 * (no window/DOM) inject its own Node-safe logo/font loading in place of the browser-only
 * drawPdfReportHeader default. */
export type PdfHeaderDrawer = (
  doc: jsPDF,
  title: string,
  opts?: { subtitle?: string; fontFamily?: string }
) => Promise<number>;

export interface TransferRow {
  clientName: string;
  oldClientId: string;
  newClientId: string;
  oldCenterName: string;
  newCenterName: string;
  fromDate: string;
  tillDate: string;
  performedBy: string;
  remarks: string;
}

/**
 * Draws the Client Transfer Report — trust header, then a single flat
 * A4-landscape table (no header grouping, no totals row — a transfer log,
 * not a financial roll-up) — extracted verbatim from the Direct Download
 * PDF logic in components/reports/TransferClient.tsx's handleExportPDF /
 * buildTransferExportRows, so the exact same rendering can be reused by
 * the Request Report queue's PDF builder (via an injected Node-safe
 * `drawHeader`) without duplicating the table logic. `drawHeader` defaults
 * to the browser drawPdfReportHeader, so the existing Direct caller is
 * unaffected by this extraction.
 */
export async function drawTransferReport(
  doc: jsPDF,
  searchedRows: TransferRow[],
  meta: { subtitle: string },
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const headers = [
    "Client Name", "Old Client ID", "New Client ID", "Old Center", "New Center",
    "From Date", "Transfer Date", "Performed By", "Remarks",
  ];
  const rows: (string | number)[][] = searchedRows.map((row) => [
    row.clientName, row.oldClientId, row.newClientId, row.oldCenterName, row.newCenterName,
    row.fromDate, row.tillDate, row.performedBy, row.remarks,
  ]);

  const headerY = await drawHeader(doc, "CLIENT TRANSFER REPORT", {
    subtitle: meta.subtitle,
    fontFamily: reportFont,
  });

  autoTable(doc, {
    startY: headerY,
    head: [headers],
    body: rows,
    styles: { fontSize: 7, font: reportFont },
    headStyles: { fillColor: getDocBrandPrimaryRgb(doc), textColor: 255, fontStyle: "bold", font: reportFont },
  });
}
