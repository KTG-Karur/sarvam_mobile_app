import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { drawPdfReportHeader } from "@/app/lib/reports/pdf-report-header";

/** Signature shared with the other migrated reports' PdfHeaderDrawer — lets a server caller
 * (no window/DOM) inject its own Node-safe logo/font loading in place of the browser-only
 * drawPdfReportHeader default. */
export type PdfHeaderDrawer = (
  doc: jsPDF,
  title: string,
  opts?: { subtitle?: string; fontFamily?: string }
) => Promise<number>;

export interface CenterMasterSummaryRow {
  ourBranchID: string;
  centreID: string;
  centreName: string;
  visitDate: string;
  fdoName: string;
  meetingDay: string;
  meetingTime: string;
  fromBranch: string;
  fromDO: string;
  contactPerson: string;
  contactPersonNumber: string;
  kmFromBranch: number | string | null;
  noOfMember: number;
  activeClients: number;
  osPrincipal: number;
  arrearMembers: number;
  arrearAmount: number;
  arrearMemOS: number;
  waitingBorrower: number;
  par: number;
}

const fmt = (n: number) =>
  new Intl.NumberFormat("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

/**
 * Draws the Center Master Summary report — trust header, then a single flat
 * A3-landscape `theme: 'grid'` table (no header grouping — the ARREAR grouping
 * exists only in the separate Word export path, not here) — extracted
 * verbatim from the Direct Download PDF logic in
 * app/dashboard/admin-reports/portfolio/center-master-report/page.tsx's
 * handlePdfExport, so the exact same rendering can be reused by the Request
 * Report queue's PDF builder (via an injected Node-safe `drawHeader`)
 * without duplicating the table logic. `drawHeader` defaults to the browser
 * drawPdfReportHeader, so the existing Direct caller is unaffected by this
 * extraction.
 */
export async function drawCenterMasterSummaryReport(
  doc: jsPDF,
  data: CenterMasterSummaryRow[],
  meta: { subtitle: string },
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const headerY = await drawHeader(doc, "Center Master Report", {
    subtitle: meta.subtitle,
    fontFamily: reportFont,
  });

  autoTable(doc, {
    startY: headerY,
    head: [[
      "Branch", "Centre ID", "Centre Name", "Visit Date", "FDO", "Mtg Day", "Mtg Time",
      "From Branch", "From DO", "Contact Person", "Contact No.", "KM", "Members", "Active", "OS Pri",
      "Arr Mem", "Arr Amt", "Arr OS", "Waiting", "PAR%",
    ]],
    body: data.map((r) => [
      r.ourBranchID, r.centreID, r.centreName, r.visitDate, r.fdoName,
      r.meetingDay, r.meetingTime, r.fromBranch, r.fromDO,
      r.contactPerson, r.contactPersonNumber, r.kmFromBranch ?? "-",
      r.noOfMember, r.activeClients, fmt(r.osPrincipal),
      r.arrearMembers, fmt(r.arrearAmount), fmt(r.arrearMemOS),
      r.waitingBorrower, r.par.toFixed(2),
    ]),
    theme: "grid",
    styles: { font: reportFont, fontSize: 7, cellPadding: 1.5 },
    headStyles: { font: reportFont, fillColor: [37, 99, 235], textColor: 255, fontStyle: "bold", fontSize: 7 },
  });
}
