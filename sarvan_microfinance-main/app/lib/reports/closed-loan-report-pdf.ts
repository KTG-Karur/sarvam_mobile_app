import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { getDocBrandPrimaryRgb, getDocBrandTintRgb } from "@/app/lib/reports/pdf-brand-color";
import { format, isValid } from "date-fns";
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

export interface ClosedLoanRow {
  sNo: number;
  regionName: string;
  divisionName: string;
  areaName: string;
  branchId: string;
  branchName: string;
  centerId: string;
  centerName: string;
  fdoName: string;
  loanId: string;
  loanType: string;
  memberId: string;
  memberName: string;
  reason: string;
  fundingName: string;
  loanDisbursementDate: string | Date | null;
  firstEmiDate: string | Date | null;
  loanMaturityDate: string | Date | null;
  preCloseDate: string | Date | null;
  closeDate: string | Date | null;
  lastEmiDate: string | Date | null;
  totalTenure: number;
  osPrincipalBeforeClose: number;
  osInterestBeforeClose: number;
  closeLoanWaiverInterest: number;
  loanAmount: number;
  amountOutstanding: number;
  interest: number;
  writeOffPrincipal: number;
  writeOffInterest: number;
  principalWaiver: number | null;
  interestWaiver: number | null;
  penaltyAmount: number | null;
  penaltyPaid: number | null;
  interestPercent: number;
  nextInstNo: number | null;
  isDead: boolean;
  deceasedPersonType: string | null;
  deceasedPersonName: string | null;
  deathCertificateName: string | null;
  approvalDocumentName: string | null;
}

const fmt = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return isValid(dt) ? format(dt, "dd/MM/yyyy") : "—";
};

const fmtAmt = (n: number) => formatReportAmount(n);

/**
 * Draws the Closed Loan Report — trust header, then a single flat
 * A3-landscape table (41 columns, tiny fontSize 4, no header grouping) with
 * a trailing Grand Total row baked into the body — extracted verbatim from
 * the Direct Download PDF logic in components/reports/ClosedLoanReport.tsx's
 * handleExportPDF, so the exact same rendering can be reused by the Request
 * Report queue's PDF builder (via an injected Node-safe `drawHeader`)
 * without duplicating the table logic. `drawHeader` defaults to the browser
 * drawPdfReportHeader, so the existing Direct caller is unaffected by this
 * extraction.
 */
export async function drawClosedLoanReport(
  doc: jsPDF,
  allData: ClosedLoanRow[],
  meta: { subtitle: string },
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const headerY = await drawHeader(doc, "Closed Loan Report", {
    subtitle: meta.subtitle,
    fontFamily: reportFont,
  });

  const allTotals = allData.reduce(
    (acc, r) => ({
      osPrincipalBeforeClose: acc.osPrincipalBeforeClose + r.osPrincipalBeforeClose,
      osInterestBeforeClose: acc.osInterestBeforeClose + r.osInterestBeforeClose,
      closeLoanWaiverInterest: acc.closeLoanWaiverInterest + r.closeLoanWaiverInterest,
      loanAmount: acc.loanAmount + r.loanAmount,
      amountOutstanding: acc.amountOutstanding + r.amountOutstanding,
      interest: acc.interest + r.interest,
      writeOffPrincipal: acc.writeOffPrincipal + r.writeOffPrincipal,
      writeOffInterest: acc.writeOffInterest + r.writeOffInterest,
      principalWaiver: acc.principalWaiver + (r.principalWaiver ?? 0),
      interestWaiver: acc.interestWaiver + (r.interestWaiver ?? 0),
      penaltyAmount: acc.penaltyAmount + (r.penaltyAmount ?? 0),
      penaltyPaid: acc.penaltyPaid + (r.penaltyPaid ?? 0),
    }),
    { osPrincipalBeforeClose: 0, osInterestBeforeClose: 0, closeLoanWaiverInterest: 0, loanAmount: 0, amountOutstanding: 0, interest: 0, writeOffPrincipal: 0, writeOffInterest: 0, principalWaiver: 0, interestWaiver: 0, penaltyAmount: 0, penaltyPaid: 0 }
  );

  autoTable(doc, {
    startY: headerY,
    head: [[
      'S.No', 'Region', 'Division', 'Area',
      'Br.ID', 'Branch', 'Ctr.ID', 'Center',
      'FDO', 'Loan ID', 'Type',
      'Mem.ID', 'Member', 'Reason', 'Funder',
      'Disb.Dt', '1st EMI', 'Maturity',
      'PreCl.Dt', 'Cl.Dt', 'Last EMI',
      'Tenure', 'OS.Pri', 'OS.Int', 'Waiver',
      'Loan Amt', 'OS.Total', 'Interest',
      'WO.Pri', 'WO.Int', 'Pri.Waiver', 'Int.Waiver', 'Penalty', 'Pen.Paid',
      'Rate%', 'Next Inst', 'Dead', 'Dcsd.Type', 'Dcsd.Name', 'Death Cert.', 'HO Approval Doc',
    ]],
    body: [
      ...allData.map((r, i) => [
        i + 1,
        r.regionName, r.divisionName, r.areaName,
        r.branchId, r.branchName, r.centerId, r.centerName,
        r.fdoName, r.loanId, r.loanType,
        r.memberId, r.memberName, r.reason || '—', r.fundingName || '—',
        fmt(r.loanDisbursementDate), fmt(r.firstEmiDate), fmt(r.loanMaturityDate),
        fmt(r.preCloseDate), fmt(r.closeDate), fmt(r.lastEmiDate),
        r.totalTenure,
        fmtAmt(r.osPrincipalBeforeClose), fmtAmt(r.osInterestBeforeClose),
        fmtAmt(r.closeLoanWaiverInterest),
        fmtAmt(r.loanAmount), fmtAmt(r.amountOutstanding), fmtAmt(r.interest),
        fmtAmt(r.writeOffPrincipal), fmtAmt(r.writeOffInterest),
        fmtAmt(r.principalWaiver ?? 0), fmtAmt(r.interestWaiver ?? 0),
        fmtAmt(r.penaltyAmount ?? 0), fmtAmt(r.penaltyPaid ?? 0),
        `${r.interestPercent}%`,
        r.nextInstNo ?? '—',
        r.isDead ? `Y (${r.deceasedPersonType ?? ''})` : '',
        r.deceasedPersonType ?? '',
        r.deceasedPersonName ?? '',
        r.deathCertificateName ?? '—',
        r.approvalDocumentName ?? '—',
      ]),
      [
        'Grand Total', '', '', '', '', '', '', '', '', '', '',
        '', '', '', '', '', '', '', '', '', '', '',
        fmtAmt(allTotals.osPrincipalBeforeClose),
        fmtAmt(allTotals.osInterestBeforeClose),
        fmtAmt(allTotals.closeLoanWaiverInterest),
        fmtAmt(allTotals.loanAmount),
        fmtAmt(allTotals.amountOutstanding),
        fmtAmt(allTotals.interest),
        fmtAmt(allTotals.writeOffPrincipal),
        fmtAmt(allTotals.writeOffInterest),
        fmtAmt(allTotals.principalWaiver),
        fmtAmt(allTotals.interestWaiver),
        fmtAmt(allTotals.penaltyAmount),
        fmtAmt(allTotals.penaltyPaid),
        '', '', '', '', '', '',
      ],
    ],
    styles: { font: reportFont, fontSize: 4, cellPadding: 0.8 },
    headStyles: { font: reportFont, fillColor: getDocBrandPrimaryRgb(doc), textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: getDocBrandTintRgb(doc) },
    footStyles: { fillColor: getDocBrandPrimaryRgb(doc), textColor: 255, fontStyle: 'bold' },
  });
}
