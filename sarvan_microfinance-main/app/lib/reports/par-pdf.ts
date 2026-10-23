import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { getDocBrandPrimaryRgb } from "@/app/lib/reports/pdf-brand-color";
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

export interface ParRow {
  branchId: string;
  branchName: string;
  centreId: string;
  centreName: string;
  productType: string;
  loanId: string;
  loanDisbursementDate: string;
  firstEmiDate: string;
  loanMaturityDate: string;
  memberId: string;
  memberName: string;
  memberNomineeName: string;
  address: string;
  district: string;
  phoneNumber: string;
  loanAmount: number;
  noOfInstallment: number;
  lastRepayDate: string;
  lastRepayAmount: number;
  collectedDues: number;
  duesLeft: number;
  loanAge: number;
  ageWise: string;
  dueDay: number;
  emi: number;
  loanPrincipal: number;
  loanInterest: number;
  loanTotal: number;
  outstandingPrincipal: number;
  outstandingInterest: number;
  outstandingTotal: number;
  overduePrincipal: number;
  overdueInterest: number;
  overdueTotal: number;
  openingOdPrincipal: number;
  openingOdInterest: number;
  openingOdTotal: number;
  currentPrincipalCollection: number;
  currentInterestCollection: number;
  currentCollectionTotal: number;
  principalCollection: number;
  interestCollection: number;
  closingOdPrincipal: number;
  closingOdInterest: number;
  closingOdTotal: number;
  funder: string;
  fdoName: string;
}

/** PAR = Closing OD Principal / Outstanding Principal * 100 */
function computePar(row: ParRow): number {
  return row.outstandingPrincipal > 0 ? (row.closingOdPrincipal / row.outstandingPrincipal) * 100 : 0;
}

function buildParExportRows(data: ParRow[]): { headers: string[]; rows: (string | number)[][] } {
  const headers = [
    "S.No", "Branch ID", "Branch", "Centre ID", "Center", "Product Type", "Loan ID",
    "Loan Disbursement Date", "1st EMI Date", "Loan Maturity Date", "Member ID", "Member Name",
    "Member Nominee Name", "Address", "District", "Phone Number", "Loan Amount",
    "No of Installment", "Last Repay Date", "Last Repay Amount", "Collected Dues", "Dues Left",
    "Loan Age", "Age Wise", "DueDay", "EMI", "Loan Principal", "Loan Interest", "Loan Total",
    "Outstanding Principal", "Outstanding Interest", "Outstanding Total", "Overdue Principal",
    "Overdue Interest", "Overdue Total", "Opening OD Principal", "Opening OD Interest",
    "Opening OD Total", "Current Principal Collection", "Current Interest Collection",
    "Current Collection Total", "Principal Collection", "Interest Collection",
    "Closing OD Principal", "Closing OD Interest", "Closing OD Total", "PAR", "Funder", "FDO Name",
  ];
  const rows: (string | number)[][] = data.map((row, index) => [
    index + 1, row.branchId, row.branchName, row.centreId, row.centreName, row.productType, row.loanId,
    row.loanDisbursementDate, row.firstEmiDate, row.loanMaturityDate, row.memberId, row.memberName,
    row.memberNomineeName, row.address, row.district, row.phoneNumber, truncateReportAmount(row.loanAmount),
    row.noOfInstallment, row.lastRepayDate, truncateReportAmount(row.lastRepayAmount), truncateReportAmount(row.collectedDues), truncateReportAmount(row.duesLeft),
    row.loanAge, row.ageWise, row.dueDay, truncateReportAmount(row.emi), truncateReportAmount(row.loanPrincipal), truncateReportAmount(row.loanInterest), truncateReportAmount(row.loanTotal),
    truncateReportAmount(row.outstandingPrincipal), truncateReportAmount(row.outstandingInterest), truncateReportAmount(row.outstandingTotal), truncateReportAmount(row.overduePrincipal),
    truncateReportAmount(row.overdueInterest), truncateReportAmount(row.overdueTotal), truncateReportAmount(row.openingOdPrincipal), truncateReportAmount(row.openingOdInterest),
    truncateReportAmount(row.openingOdTotal), truncateReportAmount(row.currentPrincipalCollection), truncateReportAmount(row.currentInterestCollection),
    truncateReportAmount(row.currentCollectionTotal), truncateReportAmount(row.principalCollection), truncateReportAmount(row.interestCollection),
    truncateReportAmount(row.closingOdPrincipal), truncateReportAmount(row.closingOdInterest), truncateReportAmount(row.closingOdTotal),
    Number(computePar(row).toFixed(2)), row.funder, row.fdoName,
  ]);
  if (data.length > 0) {
    const totalClients = data.length;
    const totalLoanAmount = data.reduce((sum, e) => sum + e.loanAmount, 0);
    const totalOutstandingPrincipal = data.reduce((sum, e) => sum + e.outstandingPrincipal, 0);
    const totalOutstandingInterest = data.reduce((sum, e) => sum + e.outstandingInterest, 0);
    const totalOutstanding = data.reduce((sum, e) => sum + e.outstandingTotal, 0);
    const totalOverduePrincipal = data.reduce((sum, e) => sum + e.overduePrincipal, 0);
    const totalOverdueInterest = data.reduce((sum, e) => sum + e.overdueInterest, 0);
    const totalOverdue = data.reduce((sum, e) => sum + e.overdueTotal, 0);
    const totalOpeningOdPrincipal = data.reduce((sum, e) => sum + e.openingOdPrincipal, 0);
    const totalOpeningOdInterest = data.reduce((sum, e) => sum + e.openingOdInterest, 0);
    const totalOpeningOdTotal = data.reduce((sum, e) => sum + e.openingOdTotal, 0);
    const totalCurrentPrincipalCollection = data.reduce((sum, e) => sum + e.currentPrincipalCollection, 0);
    const totalCurrentInterestCollection = data.reduce((sum, e) => sum + e.currentInterestCollection, 0);
    const totalCurrentCollectionTotal = data.reduce((sum, e) => sum + e.currentCollectionTotal, 0);
    const totalPrincipalCollection = data.reduce((sum, e) => sum + e.principalCollection, 0);
    const totalInterestCollection = data.reduce((sum, e) => sum + e.interestCollection, 0);
    const totalClosingOdPrincipal = data.reduce((sum, e) => sum + e.closingOdPrincipal, 0);
    const totalClosingOdInterest = data.reduce((sum, e) => sum + e.closingOdInterest, 0);
    const totalClosingOdTotal = data.reduce((sum, e) => sum + e.closingOdTotal, 0);
    const parPercentage = totalOutstandingPrincipal > 0 ? (totalClosingOdPrincipal / totalOutstandingPrincipal) * 100 : 0;

    rows.push([
      // Leading run covers columns 0-15 (S.No through Phone Number) — 16 cells, one of
      // which carries the "Grand Total (...)" label — before Loan Amount at column 16.
      // (Previously only 15 cells here, one short, which shifted every following total
      // one column left of its header.)
      "", `Grand Total (${totalClients} loans)`, "", "", "", "", "", "", "", "", "", "", "", "", "", "",
      truncateReportAmount(totalLoanAmount),
      "", "", "", "", "", "", "", "", "",
      truncateReportAmount(totalLoanAmount), "", truncateReportAmount(totalLoanAmount),
      truncateReportAmount(totalOutstandingPrincipal), truncateReportAmount(totalOutstandingInterest), truncateReportAmount(totalOutstanding),
      truncateReportAmount(totalOverduePrincipal), truncateReportAmount(totalOverdueInterest), truncateReportAmount(totalOverdue),
      truncateReportAmount(totalOpeningOdPrincipal), truncateReportAmount(totalOpeningOdInterest), truncateReportAmount(totalOpeningOdTotal),
      truncateReportAmount(totalCurrentPrincipalCollection), truncateReportAmount(totalCurrentInterestCollection), truncateReportAmount(totalCurrentCollectionTotal),
      truncateReportAmount(totalPrincipalCollection), truncateReportAmount(totalInterestCollection),
      truncateReportAmount(totalClosingOdPrincipal), truncateReportAmount(totalClosingOdInterest), truncateReportAmount(totalClosingOdTotal),
      Number(parPercentage.toFixed(2)), "", "",
    ]);
  }
  return { headers, rows };
}

/**
 * Draws the Portfolio At Risk (PAR) report — trust header, then a single flat
 * A3-landscape table (49 columns — the registry's 48-column
 * fetchPar/DETAILEDWISE_HEADERS shape plus a client-computed PAR% column,
 * matching Direct exactly) with a trailing Grand Total row — extracted
 * verbatim from the Direct Download PDF logic in
 * components/reports/PortfolioAtRiskClient.tsx's handleExportPDF /
 * buildPARExportRows, so the exact same rendering can be reused by the
 * Request Report queue's PDF builder (via an injected Node-safe
 * `drawHeader`) without duplicating the table logic. `drawHeader` defaults
 * to the browser drawPdfReportHeader, so the existing Direct caller is
 * unaffected by this extraction.
 */
export async function drawParReport(
  doc: jsPDF,
  data: ParRow[],
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const { headers, rows } = buildParExportRows(data);
  const headerY = await drawHeader(doc, "PORTFOLIO AT RISK REPORT", { fontFamily: reportFont });
  autoTable(doc, {
    startY: headerY,
    head: [headers],
    body: rows,
    styles: { fontSize: 7, font: reportFont },
    headStyles: { fillColor: getDocBrandPrimaryRgb(doc), textColor: 255, fontStyle: "bold", font: reportFont },
  });
}
