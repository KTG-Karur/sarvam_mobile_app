import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { drawPdfReportHeader } from "@/app/lib/reports/pdf-report-header";
import { truncateReportAmount } from "@/app/lib/utils/format-amount";

/** Signature shared with the other migrated reports' PdfHeaderDrawer — lets a server caller
 * (no window/DOM) inject its own Node-safe logo/font loading in place of the browser-only
 * drawPdfReportHeader default. */
export type PdfHeaderDrawer = (
  doc: jsPDF,
  title: string,
  opts?: { subtitle?: string; fontFamily?: string }
) => Promise<number>;

export interface ClientwiseDcbRow {
  branchName: string;
  centerName: string;
  fdoName: string;
  accountNo: string;
  clientName: string;
  phone: string;
  loanAc: string;
  meetingDate: string;
  openingDue: number;
  currentDemand: number;
  currentCollection: number;
  currentArrear: number;
  osArrearCall: number;
  advance: number;
  preclosure: number;
  totalCall: number;
  currentArrearAmount: number;
  closingArrear: number;
}

/**
 * Draws the Clientwise DCB report — trust header, then a single flat
 * A4-landscape table with a trailing Grand Total row (no header grouping) —
 * extracted verbatim from the Direct Download PDF logic in
 * app/dashboard/admin-reports/portfolio/clientwise-dcb/page.tsx's
 * handleExportPDF, so the exact same rendering can be reused by the Request
 * Report queue's PDF builder (via an injected Node-safe `drawHeader`)
 * without duplicating the table logic. `drawHeader` defaults to the browser
 * drawPdfReportHeader, so the existing Direct caller is unaffected by this
 * extraction.
 */
export async function drawClientwiseDcbReport(
  doc: jsPDF,
  filteredData: ClientwiseDcbRow[],
  meta: { subtitle: string },
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader,
  loanAdvanceEnabled: boolean = true
): Promise<void> {
  const headers = [
    "Branch", "Center", "FDO Name", "A/C No", "Client Name", "Phone", "Loan A/C",
    "Meeting Date", "Opening Due", "Curr Demand", "Curr Collection", "Curr Arr",
    "OS Arr Call",
    ...(loanAdvanceEnabled ? ["Adv"] : []),
    "Preclosure", "Total Call", "Curr Arr Amt", "Closing Arr",
  ];
  const data: (string | number)[][] = filteredData.map((r) => [
    r.branchName, r.centerName, r.fdoName, r.accountNo, r.clientName, r.phone, r.loanAc,
    r.meetingDate, truncateReportAmount(r.openingDue), truncateReportAmount(r.currentDemand), truncateReportAmount(r.currentCollection), truncateReportAmount(r.currentArrear),
    truncateReportAmount(r.osArrearCall),
    ...(loanAdvanceEnabled ? [truncateReportAmount(r.advance)] : []),
    truncateReportAmount(r.preclosure), truncateReportAmount(r.totalCall), truncateReportAmount(r.currentArrearAmount), truncateReportAmount(r.closingArrear),
  ]);

  if (filteredData.length > 0) {
    const totals = filteredData.reduce(
      (acc, record) => ({
        openingDue: acc.openingDue + record.openingDue,
        currentDemand: acc.currentDemand + record.currentDemand,
        currentCollection: acc.currentCollection + record.currentCollection,
        currentArrear: acc.currentArrear + record.currentArrear,
        osArrearCall: acc.osArrearCall + record.osArrearCall,
        advance: acc.advance + record.advance,
        preclosure: acc.preclosure + record.preclosure,
        totalCall: acc.totalCall + record.totalCall,
        currentArrearAmount: acc.currentArrearAmount + record.currentArrearAmount,
        closingArrear: acc.closingArrear + record.closingArrear,
      }),
      {
        openingDue: 0, currentDemand: 0, currentCollection: 0, currentArrear: 0, osArrearCall: 0,
        advance: 0, preclosure: 0, totalCall: 0, currentArrearAmount: 0, closingArrear: 0,
      }
    );
    data.push([
      `Grand Total (${filteredData.length} records)`, "", "", "", "", "", "", "",
      truncateReportAmount(totals.openingDue), truncateReportAmount(totals.currentDemand), truncateReportAmount(totals.currentCollection), truncateReportAmount(totals.currentArrear),
      truncateReportAmount(totals.osArrearCall),
      ...(loanAdvanceEnabled ? [truncateReportAmount(totals.advance)] : []),
      truncateReportAmount(totals.preclosure), truncateReportAmount(totals.totalCall),
      truncateReportAmount(totals.currentArrearAmount), truncateReportAmount(totals.closingArrear),
    ]);
  }

  const headerY = await drawHeader(doc, "CLIENTWISE DCB REPORT", {
    subtitle: meta.subtitle,
    fontFamily: reportFont,
  });

  autoTable(doc, {
    startY: headerY,
    head: [headers],
    body: data,
    styles: { font: reportFont, fontSize: 6 },
    headStyles: { font: reportFont, fillColor: [5, 150, 105], textColor: 255, fontStyle: "bold" },
  });
}
