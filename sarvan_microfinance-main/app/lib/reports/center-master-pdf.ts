import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { getDocBrandPrimaryRgb } from "@/app/lib/reports/pdf-brand-color";
import { drawPdfReportHeader } from "@/app/lib/reports/pdf-report-header";
import { normalizeMeetingTime } from "@/app/lib/utils/meeting-time";

/** Signature shared with the other migrated reports' PdfHeaderDrawer — lets a server caller
 * (no window/DOM) inject its own Node-safe logo/font loading in place of the browser-only
 * drawPdfReportHeader default. */
export type PdfHeaderDrawer = (
  doc: jsPDF,
  title: string,
  opts?: { subtitle?: string; fontFamily?: string }
) => Promise<number>;

export interface CenterMasterRow {
  branchId: string;
  centerId: string;
  centerName: string;
  employeeName: string;
  meetingDay: string;
  meetingTime: string | null;
  kmFromBranch: number | string | null;
  contactPerson: string;
  contactPersonNumber: string;
  clients: number;
  waitingBorrowers: number;
  portfolio: number;
  arrear: number;
  advance: number;
  advAdjustment: number;
  preclosure: number;
}

/**
 * Draws the Center Master Report — trust header, then a single flat
 * A4-landscape table with a trailing Grand Total row (no header grouping) —
 * extracted verbatim from the Direct Download PDF logic in
 * components/reports/CenterMasterClient.tsx's handleExportPDF, so the exact
 * same rendering can be reused by the Request Report queue's PDF builder
 * (via an injected Node-safe `drawHeader`) without duplicating the table
 * logic. `drawHeader` defaults to the browser drawPdfReportHeader, so the
 * existing Direct caller is unaffected by this extraction.
 */
export async function drawCenterMasterReport(
  doc: jsPDF,
  searchedRows: CenterMasterRow[],
  meta: { subtitle: string },
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const headers = [
    "Sl No", "Branch ID", "Center ID", "Center Name", "Employee Name", "Meeting Day",
    "Meeting Time", "KM From Branch", "Contact Person", "Contact Person No.", "Clients",
    "Waiting Borrowers", "Portfolio", "Arrear", "Advance", "Adv Adjustment", "Preclosure",
  ];
  const rows: (string | number)[][] = searchedRows.map((row, index) => [
    index + 1, row.branchId, row.centerId, row.centerName, row.employeeName, row.meetingDay,
    row.meetingTime ? normalizeMeetingTime(row.meetingTime) : "", row.kmFromBranch ?? "", row.contactPerson, row.contactPersonNumber, row.clients,
    row.waitingBorrowers, row.portfolio, row.arrear, row.advance, row.advAdjustment, row.preclosure,
  ]);
  if (searchedRows.length > 0) {
    const totClients = searchedRows.reduce((a, c) => a + (c.clients || 0), 0);
    const totWB = searchedRows.reduce((a, c) => a + (c.waitingBorrowers || 0), 0);
    const totPortfolio = searchedRows.reduce((a, c) => a + (c.portfolio || 0), 0);
    const totArrear = searchedRows.reduce((a, c) => a + (c.arrear || 0), 0);
    const totAdv = searchedRows.reduce((a, c) => a + (c.advance || 0), 0);
    const totAdvAdj = searchedRows.reduce((a, c) => a + (c.advAdjustment || 0), 0);
    const totPre = searchedRows.reduce((a, c) => a + (c.preclosure || 0), 0);
    rows.push([
      "", "Grand Total:", "", "", "", "", "", "", "", "",
      totClients, totWB, totPortfolio, totArrear, totAdv, totAdvAdj, totPre,
    ]);
  }

  const headerY = await drawHeader(doc, "CENTER MASTER REPORT", {
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
