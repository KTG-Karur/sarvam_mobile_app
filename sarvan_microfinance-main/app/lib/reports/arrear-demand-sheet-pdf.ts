import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { getDocBrandPrimaryRgb, getDocBrandTintRgb } from "@/app/lib/reports/pdf-brand-color";
import { drawPdfReportHeader } from "@/app/lib/reports/pdf-report-header";
import type { ArrearDemandSheetRow, ArrearDemandSheetMeta } from "@/app/lib/actions/demand";
import { formatReportAmount } from "@/app/lib/utils/format-amount";

/** Signature shared with the other migrated reports' PdfHeaderDrawer — lets a server caller
 * (no window/DOM) inject its own Node-safe logo/font loading in place of the browser-only
 * drawPdfReportHeader default. */
export type PdfHeaderDrawer = (
  doc: jsPDF,
  title: string,
  opts?: { subtitle?: string; fontFamily?: string }
) => Promise<number>;

const formatCurrency = (amount: number) => formatReportAmount(amount);

/**
 * Draws the Arrear Demand Sheet — trust header, then a single flat
 * A4-landscape table with a bold Total row (colSpan 4 label) — extracted
 * verbatim from the Direct Download PDF logic in
 * app/dashboard/reports/demand/arrear-demand-sheet/page.tsx's
 * handleDownloadPDF, so the exact same rendering can be reused by the
 * Request Report queue's PDF builder (via an injected Node-safe
 * `drawHeader`) without duplicating the table logic. `drawHeader` defaults
 * to the browser drawPdfReportHeader, so the existing Direct caller is
 * unaffected by this extraction.
 */
export async function drawArrearDemandSheetReport(
  doc: jsPDF,
  rows: ArrearDemandSheetRow[],
  meta: ArrearDemandSheetMeta,
  dateFormatted: string,
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const headerY = await drawHeader(doc, "Arrear Demand Sheet", {
    subtitle: `Branch: ${meta.branchName} (${meta.branchCode})   Center: ${meta.centerName} (${meta.centerCode})   Arrear Date: ${dateFormatted}   Total Clients: ${meta.totalClients}`,
    fontFamily: reportFont,
  });

  autoTable(doc, {
    startY: headerY,
    head: [[
      "S.No", "Member ID", "Member Name", "Loan ID",
      "Arrear Principal", "Arrear Interest", "Fees Due", "Penalties", "Total Arrear",
      "Coll. Status", "Coll. Amount", "Coll. Date", "Coll. Time", "Collected By",
    ]],
    body: [
      ...rows.map((r) => [
        r.sNo,
        r.clientId,
        r.clientName,
        r.loanId,
        formatCurrency(r.arrearPrincipal),
        formatCurrency(r.arrearInterest),
        formatCurrency(r.feesDue),
        formatCurrency(r.penaltiesDue),
        formatCurrency(r.totalArrearDue),
        r.collectionStatus,
        r.collectedAmount != null ? formatCurrency(r.collectedAmount) : "",
        r.collectionDateDisplay ?? "",
        r.collectionTimeDisplay ?? "",
        r.collectedBy ?? "",
      ]),
      [
        { content: "Total", colSpan: 4, styles: { fontStyle: "bold" } },
        { content: formatCurrency(meta.totalArrearPrincipal), styles: { fontStyle: "bold" } },
        { content: formatCurrency(meta.totalArrearInterest), styles: { fontStyle: "bold" } },
        { content: formatCurrency(meta.totalFeesDue), styles: { fontStyle: "bold" } },
        { content: formatCurrency(meta.totalPenaltiesDue), styles: { fontStyle: "bold" } },
        { content: formatCurrency(meta.totalArrearDue), styles: { fontStyle: "bold" } },
        "", "", "", "", "",
      ],
    ],
    styles: { font: reportFont, fontSize: 7, cellPadding: 2 },
    headStyles: { font: reportFont, fillColor: getDocBrandPrimaryRgb(doc), textColor: 255, fontStyle: "bold", fontSize: 7.5 },
    alternateRowStyles: { fillColor: getDocBrandTintRgb(doc) },
    columnStyles: {
      0: { halign: "center", cellWidth: 10 },
      1: { cellWidth: 22 },
      4: { halign: "right" },
      5: { halign: "right" },
      6: { halign: "right" },
      7: { halign: "right" },
      8: { halign: "right", fontStyle: "bold" },
      9: { halign: "center", cellWidth: 18 },
      10: { halign: "right", cellWidth: 22 },
      11: { halign: "center", cellWidth: 22 },
      12: { halign: "center", cellWidth: 18 },
    },
  });
}
