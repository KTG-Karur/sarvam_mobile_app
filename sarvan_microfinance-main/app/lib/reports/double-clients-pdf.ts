import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { getDocBrandPrimaryRgb } from "@/app/lib/reports/pdf-brand-color";
import { format } from "date-fns";
import { drawPdfReportHeader } from "@/app/lib/reports/pdf-report-header";
import { getPersonLabel } from "@/app/lib/person-label";
import { truncateReportAmount } from "@/app/lib/utils/format-amount";

/** Signature shared with the other migrated reports' PdfHeaderDrawer — lets a server caller
 * (no window/DOM) inject its own Node-safe logo/font loading in place of the browser-only
 * drawPdfReportHeader default. */
export type PdfHeaderDrawer = (
  doc: jsPDF,
  title: string,
  opts?: { subtitle?: string; fontFamily?: string }
) => Promise<number>;

export interface DoubleClientsRow {
  slNo: number;
  clientName: string;
  hasLoan?: boolean;
  smartCardNo: string;
  pancardNo: string;
  votersIdNo: string;
  mobileNo: string;
  loanAcNo: string;
  disbursalDate: string | Date | null;
  loanBalance: number;
  matchValue: string | number | null;
}

/**
 * Draws the Double Members report — trust header, then a single flat
 * A4-landscape table (no header grouping, no Grand Total row) — extracted
 * verbatim from the Direct Download PDF logic in
 * components/reports/DoubleClientsClient.tsx's handleExportPDF, so the
 * exact same rendering can be reused by the Request Report queue's PDF
 * builder (via an injected Node-safe `drawHeader`) without duplicating the
 * table logic. `drawHeader` defaults to the browser drawPdfReportHeader, so
 * the existing Direct caller is unaffected by this extraction.
 */
export async function drawDoubleClientsReport(
  doc: jsPDF,
  filteredData: DoubleClientsRow[],
  meta: { subtitle: string },
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const headers = ["Sl No", "Name", "Member / Client", "Smart Card No", "PAN No", "Voter ID No", "Mobile No", "Loan A/c No", "Disbursal Date", "Loan Balance", "Match Field Value"];
  const rows: (string | number)[][] = filteredData.map((item) => [
    item.slNo, item.clientName, getPersonLabel(!!item.hasLoan).singular, item.smartCardNo, item.pancardNo,
    item.votersIdNo, item.mobileNo, item.loanAcNo,
    item.disbursalDate ? format(new Date(item.disbursalDate), "dd/MM/yyyy") : "N/A",
    truncateReportAmount(item.loanBalance), item.matchValue ?? "",
  ]);

  const headerY = await drawHeader(doc, "DOUBLE MEMBERS REPORT", {
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
