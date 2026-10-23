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

export interface DeathMemberRow {
  regionName: string;
  divisionName: string;
  areaName: string;
  branchId: string;
  branchName: string;
  centerId: string;
  centerName: string;
  fdoName: string;
  dateOfDeath: string | Date | null;
  deathPerson: string;
  productType: string;
  loanId: string;
  memberId: string;
  memberName: string;
  nomineeName: string;
  address: string;
  district: string;
  phoneNumber: string;
  aadhaarNumber: string;
  loanDisbursementDate: string | Date | null;
  firstEmiDate: string | Date | null;
  loanMaturityDate: string | Date | null;
  loanPrincipal: number;
  loanInterest: number;
  loanAmount: number;
  osPrincipal: number;
  osInterest: number;
  osTotal: number;
  arrearPrincipal: number;
  arrearInterest: number;
  arrearTotal: number;
  interestRate: number;
  fundingName: string;
  deathCertificateName: string | null;
}

const fmt = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return isValid(dt) ? format(dt, "dd/MM/yyyy") : "—";
};

const fmtAmt = (n: number) => formatReportAmount(n);

/**
 * Draws the Death Member Report — trust header, then a single flat
 * A3-landscape table (no header grouping — the PDF path is flat; grouping
 * exists only in the separate Word export path) with a trailing Totals row
 * — extracted verbatim from the Direct Download PDF logic in
 * components/reports/DeathMemberReport.tsx's handleExportPDF, so the exact
 * same rendering can be reused by the Request Report queue's PDF builder
 * (via an injected Node-safe `drawHeader`) without duplicating the table
 * logic. `drawHeader` defaults to the browser drawPdfReportHeader, so the
 * existing Direct caller is unaffected by this extraction.
 */
export async function drawDeathMemberReport(
  doc: jsPDF,
  filteredData: DeathMemberRow[],
  meta: { subtitle: string },
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const headerY = await drawHeader(doc, "Death Member Report", {
    subtitle: meta.subtitle,
    fontFamily: reportFont,
  });

  const totals = filteredData.reduce(
    (acc, r) => ({
      loanPrincipal: acc.loanPrincipal + r.loanPrincipal,
      loanInterest: acc.loanInterest + r.loanInterest,
      loanAmount: acc.loanAmount + r.loanAmount,
      osPrincipal: acc.osPrincipal + r.osPrincipal,
      osInterest: acc.osInterest + r.osInterest,
      osTotal: acc.osTotal + r.osTotal,
      arrearPrincipal: acc.arrearPrincipal + r.arrearPrincipal,
      arrearInterest: acc.arrearInterest + r.arrearInterest,
      arrearTotal: acc.arrearTotal + r.arrearTotal,
    }),
    {
      loanPrincipal: 0, loanInterest: 0, loanAmount: 0,
      osPrincipal: 0, osInterest: 0, osTotal: 0,
      arrearPrincipal: 0, arrearInterest: 0, arrearTotal: 0,
    }
  );

  autoTable(doc, {
    startY: headerY,
    head: [[
      'S.No', 'Region', 'Division', 'Area', 'Br.ID', 'Branch', 'Ctr.ID', 'Center',
      'FDO', 'Death Date', 'Death Person', 'Product', 'Loan ID',
      'Mem.ID', 'Member Name', 'Nominee', 'Address', 'District',
      'Phone', 'Aadhaar', 'Disb.Date', '1st EMI', 'Maturity',
      'Principal', 'Interest', 'Loan Amt',
      'OS.Pri', 'OS.Int', 'OS.Total',
      'Arr.Pri', 'Arr.Int', 'Arr.Total',
      'Rate%', 'Funder', 'Death Cert.',
    ]],
    body: filteredData.map((r, i) => [
      i + 1,
      r.regionName, r.divisionName, r.areaName,
      r.branchId, r.branchName, r.centerId, r.centerName,
      r.fdoName, fmt(r.dateOfDeath), r.deathPerson, r.productType,
      r.loanId, r.memberId, r.memberName, r.nomineeName,
      r.address, r.district, r.phoneNumber, r.aadhaarNumber,
      fmt(r.loanDisbursementDate), fmt(r.firstEmiDate), fmt(r.loanMaturityDate),
      fmtAmt(r.loanPrincipal), fmtAmt(r.loanInterest), fmtAmt(r.loanAmount),
      fmtAmt(r.osPrincipal), fmtAmt(r.osInterest), fmtAmt(r.osTotal),
      fmtAmt(r.arrearPrincipal), fmtAmt(r.arrearInterest), fmtAmt(r.arrearTotal),
      r.interestRate, r.fundingName, r.deathCertificateName ?? '—',
    ]).concat(filteredData.length > 0 ? [[
      `Totals (${filteredData.length} records)`, '', '', '', '', '', '', '',
      '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
      fmtAmt(totals.loanPrincipal), fmtAmt(totals.loanInterest), fmtAmt(totals.loanAmount),
      fmtAmt(totals.osPrincipal), fmtAmt(totals.osInterest), fmtAmt(totals.osTotal),
      fmtAmt(totals.arrearPrincipal), fmtAmt(totals.arrearInterest), fmtAmt(totals.arrearTotal),
      '', '', '',
    ]] : []),
    styles: { font: reportFont, fontSize: 5, cellPadding: 1 },
    headStyles: { font: reportFont, fillColor: getDocBrandPrimaryRgb(doc), textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: getDocBrandTintRgb(doc) },
  });
}
