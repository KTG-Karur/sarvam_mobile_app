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

export interface PortfolioRow {
  regionName: string;
  divisionName: string;
  areaName: string;
  branchId: string;
  branchName: string;
  centerId: string;
  centerName: string;
  fdoName: string;
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
  isDead: boolean;
  deceasedPersonType: string | null;
}

const fmt = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return isValid(dt) ? format(dt, "dd/MM/yyyy") : "—";
};

const fmtAmt = (n: number) => formatReportAmount(n);

/**
 * Draws the Client Portfolio Report — trust header, then a single flat
 * A3-landscape table (33 columns, tiny fontSize 5, no header grouping) with
 * a trailing Grand Total row — extracted verbatim from the Direct Download
 * PDF logic in components/reports/ClientPortfolioReport.tsx's
 * handleExportPDF, so the exact same rendering can be reused by the Request
 * Report queue's PDF builder (via an injected Node-safe `drawHeader`)
 * without duplicating the table logic. `drawHeader` defaults to the browser
 * drawPdfReportHeader, so the existing Direct caller is unaffected by this
 * extraction.
 *
 * Note: this 33-column shape (isDead/deceasedPersonType folded into one
 * "Dead?" column) is narrower than report-registry.ts's fetchClientPortfolioReport
 * (34 columns, separate Deceased Person Type/Name columns, used for
 * Excel/CSV/Word) — this function intentionally takes the same typed
 * PortfolioRow[] Direct itself builds from, not that flattened row shape.
 */
export async function drawClientPortfolioReport(
  doc: jsPDF,
  allData: PortfolioRow[],
  meta: { subtitle: string },
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const headerY = await drawHeader(doc, "Client Portfolio Report", {
    subtitle: meta.subtitle,
    fontFamily: reportFont,
  });

  const allTotals = allData.reduce(
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
    { loanPrincipal: 0, loanInterest: 0, loanAmount: 0, osPrincipal: 0, osInterest: 0, osTotal: 0, arrearPrincipal: 0, arrearInterest: 0, arrearTotal: 0 }
  );

  autoTable(doc, {
    startY: headerY,
    head: [[
      'S.No', 'Region', 'Division', 'Area', 'Br.ID', 'Branch',
      'Ctr.ID', 'Center', 'FDO', 'Product', 'Loan ID',
      'Mem.ID', 'Member Name', 'Nominee', 'Address', 'District',
      'Phone', 'Aadhaar', 'Disb.Date', '1st EMI', 'Maturity',
      'Principal', 'Interest', 'Loan Amt',
      'OS.Pri', 'OS.Int', 'OS.Total',
      'Arr.Pri', 'Arr.Int', 'Arr.Total',
      'Rate%', 'Funder', 'Dead?',
    ]],
    body: [
      ...allData.map((r, i) => [
        i + 1,
        r.regionName, r.divisionName, r.areaName,
        r.branchId, r.branchName, r.centerId, r.centerName,
        r.fdoName, r.productType, r.loanId,
        r.memberId, r.memberName, r.nomineeName,
        r.address, r.district, r.phoneNumber, r.aadhaarNumber,
        fmt(r.loanDisbursementDate), fmt(r.firstEmiDate), fmt(r.loanMaturityDate),
        fmtAmt(r.loanPrincipal), fmtAmt(r.loanInterest), fmtAmt(r.loanAmount),
        fmtAmt(r.osPrincipal), fmtAmt(r.osInterest), fmtAmt(r.osTotal),
        fmtAmt(r.arrearPrincipal), fmtAmt(r.arrearInterest), fmtAmt(r.arrearTotal),
        r.interestRate, r.fundingName,
        r.isDead ? `Y (${r.deceasedPersonType ?? ''})` : '',
      ]),
      [
        'Grand Total', '', '', '', '', '', '', '', '', '', '',
        '', '', '', '', '', '', '', '', '', '',
        fmtAmt(allTotals.loanPrincipal), fmtAmt(allTotals.loanInterest), fmtAmt(allTotals.loanAmount),
        fmtAmt(allTotals.osPrincipal), fmtAmt(allTotals.osInterest), fmtAmt(allTotals.osTotal),
        fmtAmt(allTotals.arrearPrincipal), fmtAmt(allTotals.arrearInterest), fmtAmt(allTotals.arrearTotal),
        '', '', '',
      ],
    ],
    styles: { font: reportFont, fontSize: 5, cellPadding: 1 },
    headStyles: { font: reportFont, fillColor: getDocBrandPrimaryRgb(doc), textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: getDocBrandTintRgb(doc) },
    footStyles: { fillColor: getDocBrandPrimaryRgb(doc), textColor: 255, fontStyle: 'bold' },
  });
}
