import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { drawPdfReportHeader } from "@/app/lib/reports/pdf-report-header";
import type { AgewiseArrearRow } from "@/app/lib/actions/reports";

/** Signature shared with the other migrated reports' PdfHeaderDrawer — lets a server caller
 * (no window/DOM) inject its own Node-safe logo/font loading in place of the browser-only
 * drawPdfReportHeader default. */
export type PdfHeaderDrawer = (
  doc: jsPDF,
  title: string,
  opts?: { subtitle?: string; fontFamily?: string }
) => Promise<number>;

/**
 * Draws the Portfolio Age-wise Arrear report — trust header, then a single
 * flat A4-landscape table (no header grouping for the age-bucket columns —
 * they're flat in Direct's own PDF, unlike the unrelated mis-agewise-arrear
 * report's Word export — and no totals row) — extracted verbatim from the
 * Direct Download PDF logic in
 * app/dashboard/admin-reports/portfolio/agewise-arrear/page.tsx's
 * handleExportPDF / buildArrearExportRows, so the exact same rendering can
 * be reused by the Request Report queue's PDF builder (via an injected
 * Node-safe `drawHeader`) without duplicating the table logic. `drawHeader`
 * defaults to the browser drawPdfReportHeader, so the existing Direct
 * caller is unaffected by this extraction.
 */
export async function drawAgewiseArrearReport(
  doc: jsPDF,
  rows: AgewiseArrearRow[],
  meta: { subtitle: string },
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const headers = [
    "Branch", "Center", "Client Name", "Phone", "Loan A/C", "Loan Amt", "Pri Balance",
    "Total Dues", "Disbursal", "1-30 Days", "31-60 Days", "61-90 Days", "91-180 Days",
    ">180 Days", "Arrear Pri", "Arrear Int", "Total Arrear", "FDO",
  ];
  const body: (string | number)[][] = rows.map((r) => [
    r.branchName, r.centerName, r.clientName, r.phone, r.loanAccount, r.loanAmount,
    r.priBalance, r.totalDues, r.disbursalDate, r.days1to30, r.days31to60, r.days61to90,
    r.days91to180, r.above180, r.arrearPri, r.arrearInt, r.totalArrear, r.fdoName,
  ]);

  const headerY = await drawHeader(doc, "AGEWISE ARREAR REPORT", {
    subtitle: meta.subtitle,
    fontFamily: reportFont,
  });

  autoTable(doc, {
    startY: headerY,
    head: [headers],
    body,
    styles: { font: reportFont, fontSize: 6.5 },
    headStyles: { font: reportFont, fillColor: [220, 38, 38], textColor: 255, fontStyle: "bold" },
  });
}
