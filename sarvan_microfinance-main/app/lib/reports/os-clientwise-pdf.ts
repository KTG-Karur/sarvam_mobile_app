import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { getDocBrandPrimaryRgb } from "@/app/lib/reports/pdf-brand-color";
import { drawPdfReportHeader } from "@/app/lib/reports/pdf-report-header";
import type { OSClientwiseRow } from "@/app/lib/actions/reports";
import { truncateReportAmount } from "@/app/lib/utils/format-amount";

/** Signature shared with the other migrated reports' PdfHeaderDrawer — lets a server caller
 * (no window/DOM) inject its own Node-safe logo/font loading in place of the browser-only
 * drawPdfReportHeader default. */
export type PdfHeaderDrawer = (
  doc: jsPDF,
  title: string,
  opts?: { subtitle?: string; fontFamily?: string }
) => Promise<number>;

/**
 * Draws the OS Clientwise report — trust header, then a single flat
 * A4-landscape table (no header grouping — grouping exists only in the
 * separate Word export path — and no totals row) — extracted verbatim
 * from the Direct Download PDF logic in
 * app/dashboard/admin-reports/portfolio/os-clientwise/page.tsx's
 * handleExportPDF / buildOSClientwiseExportRows, so the exact same
 * rendering can be reused by the Request Report queue's PDF builder (via
 * an injected Node-safe `drawHeader`) without duplicating the table logic.
 * `drawHeader` defaults to the browser drawPdfReportHeader, so the
 * existing Direct caller is unaffected by this extraction.
 *
 * Shared by both "os-clientwise-admin" and "loan-os-client" registry
 * slugs (two separate page UIs over the same getOSClientwiseData query).
 */
export async function drawOsClientwiseReport(
  doc: jsPDF,
  rows: OSClientwiseRow[],
  meta: { subtitle: string },
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const headers = [
    "Branch Name", "Center Name", "Client Name", "Disbursal Date", "Loan Amount",
    "Due Start Date", "Tenure", "Loan A/c", "OS Principle", "OS Interest",
    "Arrear Pri", "Arrear Int", "Funder", "Mobile #",
  ];
  const body: (string | number)[][] = rows.map((item) => [
    item.branchName, item.centerName, item.clientName, item.disbursalDate, truncateReportAmount(item.loanAmount),
    item.dueStartDate, item.tenure, item.loanAc, truncateReportAmount(item.osPrincipal), truncateReportAmount(item.osInterest),
    truncateReportAmount(item.arrearPri), truncateReportAmount(item.arrearInt), item.funder, item.mobileNo,
  ]);

  const headerY = await drawHeader(doc, "OS CLIENTWISE REPORT", {
    subtitle: meta.subtitle,
    fontFamily: reportFont,
  });

  autoTable(doc, {
    startY: headerY,
    head: [headers],
    body,
    styles: { font: reportFont, fontSize: 7 },
    headStyles: { font: reportFont, fillColor: getDocBrandPrimaryRgb(doc), textColor: 255, fontStyle: "bold" },
  });
}
