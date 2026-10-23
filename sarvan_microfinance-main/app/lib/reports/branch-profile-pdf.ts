import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { getDocBrandPrimaryRgb, getDocBrandTintRgb } from "@/app/lib/reports/pdf-brand-color";
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

export interface BranchProfileData {
  branchInfo: {
    regionName: string;
    divisionName: string;
    areaName: string;
    branchId: string;
    branchName: string;
    branchStartDate: string;
    noOfCenters: number;
    noOfGroups: number;
    noOfFdo: number;
  };
  reportMeta: {
    branchProfileDate: string;
    reportDayName: string;
    reportYmd: string;
  };
  sinceApril: {
    openingMembers: number;
    newMembers: number;
    rejectedMembers: number;
    closingMembers: number;
    waitingBorrowers: number;
    activeMembers: number;
    loanDisbursement: number;
    loanDisbursementMemberCount: number;
    cumulativeArrear: number;
    arrearMemberCount: number;
    parPercent: number;
  };
  currentDay: {
    openingMembers: number;
    newMembers: number;
    rejectedMembers: number;
    closingMembers: number;
    waitingBorrowers: number;
    activeMembers: number;
    loanDisbursement: number;
    outstandingBalance: number;
    demandPrincipal: number;
    demandInterest: number;
    demandTotal: number;
    collectionPrincipal: number;
    collectionInterest: number;
    collectionTotal: number;
    arrearPrincipal: number;
    arrearTotal: number;
    recoveryRate: number;
    arrearCollection: number;
    advanceCollection: number;
  };
}

function fmtAmt(n: number): string {
  return `₹ ${formatReportAmount(n)}`;
}

function fmtPct(n: number): string {
  return `${n.toFixed(2)}%`;
}

/**
 * Draws the Branch Profile report — trust header, then two genuinely distinct
 * autoTable sections (a body-only 6-column key/value info grid, then a
 * 3-column head+body "Since April vs Current Day" comparison table) —
 * extracted verbatim from the Direct Download PDF logic in
 * components/reports/BranchProfileClient.tsx's handlePdfExport, so the exact
 * same rendering can be reused by the Request Report queue's PDF builder (via
 * an injected Node-safe `drawHeader`) without duplicating the table logic.
 * `drawHeader` defaults to the browser drawPdfReportHeader, so the existing
 * Direct caller is unaffected by this extraction.
 */
export async function drawBranchProfileReport(
  doc: jsPDF,
  data: BranchProfileData,
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const { branchInfo, reportMeta, sinceApril, currentDay } = data;
  const cdHeader = `On ${reportMeta.branchProfileDate} (${reportMeta.reportDayName})`;

  const headerY = await drawHeader(doc, "Branch Profile", {
    subtitle: `Branch Profile Date: ${reportMeta.branchProfileDate}    Branch Start Date: ${branchInfo.branchStartDate}`,
    fontFamily: reportFont,
  });

  // Branch info block
  autoTable(doc, {
    startY: headerY,
    body: [
      ["Region", branchInfo.regionName, "Division", branchInfo.divisionName, "Area", branchInfo.areaName],
      ["Branch ID", branchInfo.branchId, "Branch Name", branchInfo.branchName, "Start Date", branchInfo.branchStartDate],
      ["Centers", branchInfo.noOfCenters, "Groups", branchInfo.noOfGroups, "FDOs", branchInfo.noOfFdo],
      ["No. of Members", sinceApril.closingMembers, "Active Borrowers", sinceApril.activeMembers, "Arrear Members", sinceApril.arrearMemberCount],
      ["Outstanding Balance", fmtAmt(currentDay.outstandingBalance), "Cumulative Arrear", fmtAmt(sinceApril.cumulativeArrear), "", ""],
    ],
    theme: "grid",
    styles: { font: reportFont, fontSize: 8, cellPadding: 2 },
    headStyles: { font: reportFont },
    columnStyles: {
      0: { fontStyle: "bold", fillColor: getDocBrandTintRgb(doc), cellWidth: 22 },
      1: { cellWidth: 28 },
      2: { fontStyle: "bold", fillColor: getDocBrandTintRgb(doc), cellWidth: 22 },
      3: { cellWidth: 28 },
      4: { fontStyle: "bold", fillColor: getDocBrandTintRgb(doc), cellWidth: 22 },
      5: { cellWidth: 60 },
    },
  });

  // Two-column comparison table
  const tableY = (doc as any).lastAutoTable.finalY + 6;
  autoTable(doc, {
    startY: tableY,
    head: [["Particulars", "Since April", cdHeader]],
    body: [
      ["Opening Members", sinceApril.openingMembers, currentDay.openingMembers],
      ["New Members", sinceApril.newMembers, currentDay.newMembers],
      ["Rejected Members", sinceApril.rejectedMembers, currentDay.rejectedMembers],
      ["Closing Members", sinceApril.closingMembers, currentDay.closingMembers],
      ["Waiting Borrowers", sinceApril.waitingBorrowers, currentDay.waitingBorrowers],
      ["Active Members", sinceApril.activeMembers, currentDay.activeMembers],
      [`Loan Disbursement`, fmtAmt(sinceApril.loanDisbursement), fmtAmt(currentDay.loanDisbursement)],
      ["Loan Disbursement Members", sinceApril.loanDisbursementMemberCount, "—"],
      ["Outstanding Balance", "—", fmtAmt(currentDay.outstandingBalance)],
      ["Demand Principal", "—", fmtAmt(currentDay.demandPrincipal)],
      ["Demand Interest", "—", fmtAmt(currentDay.demandInterest)],
      ["Demand Total", "—", fmtAmt(currentDay.demandTotal)],
      ["Collected Principal", "—", fmtAmt(currentDay.collectionPrincipal)],
      ["Collected Interest", "—", fmtAmt(currentDay.collectionInterest)],
      ["Total Collection", "—", fmtAmt(currentDay.collectionTotal)],
      ["Cumulative Arrear", fmtAmt(sinceApril.cumulativeArrear), "—"],
      ["Arrear Member Count", sinceApril.arrearMemberCount, "—"],
      ["Arrear Principal", "—", fmtAmt(currentDay.arrearPrincipal)],
      ["Arrear Total", "—", fmtAmt(currentDay.arrearTotal)],
      ["PAR %", fmtPct(sinceApril.parPercent), "—"],
      ["Recovery Rate", "—", fmtPct(currentDay.recoveryRate)],
      ["Arrear Collection", "—", fmtAmt(currentDay.arrearCollection)],
      ["Advance Collection", "—", fmtAmt(currentDay.advanceCollection)],
    ],
    theme: "grid",
    headStyles: { font: reportFont, fillColor: getDocBrandPrimaryRgb(doc), textColor: 255, fontStyle: "bold", fontSize: 8 },
    styles: { font: reportFont, fontSize: 8, cellPadding: 2 },
    columnStyles: {
      0: { fontStyle: "bold", fillColor: getDocBrandTintRgb(doc), cellWidth: 62 },
      1: { cellWidth: 60, halign: "right" },
      2: { cellWidth: 60, halign: "right" },
    },
    alternateRowStyles: { fillColor: [249, 254, 251] },
  });
}
