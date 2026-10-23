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

export interface BranchDemandRow {
  fdo: string;
  center: string;
  meetingTime: string;
  noOfClients: number;
  wb: number;
  osPri: number;
  osInt: number;
  arrearPri: number;
  arrearInt: number;
  arrearSavings: number | null;
  demandPri: number;
  demandInt: number;
  demandSavings: number | null;
  totalDemand: number;
}

function formatTime(timeString: string): string {
  if (!timeString) return "";
  if (timeString === "Total") return "Total";
  if (/^\d{2}:\d{2}$/.test(timeString)) return timeString;
  try {
    const date = new Date(`2000-01-01T${timeString}`);
    if (isNaN(date.getTime())) return timeString;
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
  } catch {
    return timeString;
  }
}

/**
 * Draws the Branch Demand report — trust header, then a single flat
 * A4-landscape table with a trailing GRAND TOTAL row (no header grouping —
 * the PDF path is flat; grouping exists only in the separate Word export
 * path) — extracted verbatim from the Direct Download PDF logic in
 * components/reports/BranchDemandClient.tsx's handleExportPDF, so the exact
 * same rendering can be reused by the Request Report queue's PDF builder
 * (via an injected Node-safe `drawHeader`) without duplicating the table
 * logic. `drawHeader` defaults to the browser drawPdfReportHeader, so the
 * existing Direct caller is unaffected by this extraction.
 */
export async function drawBranchDemandReport(
  doc: jsPDF,
  fullData: BranchDemandRow[],
  meta: { subtitle: string },
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader,
  loanAdvanceEnabled: boolean = true
): Promise<void> {
  const headers = [
    "Sl No", "FDO", "Center", "Meeting Time", "# Clients", "WB", "OS Pri", "OS Int",
    "Arrear Pri", "Arrear Int",
    ...(loanAdvanceEnabled ? ["Arrear Sav"] : []),
    "Demand Pri", "Demand Int",
    ...(loanAdvanceEnabled ? ["Demand Sav"] : []),
    "Total Demand",
  ];
  const rows: (string | number)[][] = fullData.map((row, index) => [
    index + 1, row.fdo, row.center, formatTime(row.meetingTime), row.noOfClients, row.wb,
    row.osPri, row.osInt, row.arrearPri, row.arrearInt,
    ...(loanAdvanceEnabled ? [row.arrearSavings || 0] : []),
    row.demandPri, row.demandInt,
    ...(loanAdvanceEnabled ? [row.demandSavings || 0] : []),
    row.totalDemand,
  ]);

  if (fullData.length > 0) {
    const sum = (fn: (r: BranchDemandRow) => number) => fullData.reduce((s, r) => s + fn(r), 0);
    rows.push([
      "", "GRAND TOTAL", "", "", sum((r) => r.noOfClients), sum((r) => r.wb), sum((r) => r.osPri), sum((r) => r.osInt),
      sum((r) => r.arrearPri), sum((r) => r.arrearInt),
      ...(loanAdvanceEnabled ? [sum((r) => r.arrearSavings || 0)] : []),
      sum((r) => r.demandPri), sum((r) => r.demandInt),
      ...(loanAdvanceEnabled ? [sum((r) => r.demandSavings || 0)] : []),
      sum((r) => r.totalDemand),
    ]);
  }

  const headerY = await drawHeader(doc, "BRANCH DEMAND REPORT", {
    subtitle: meta.subtitle,
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
