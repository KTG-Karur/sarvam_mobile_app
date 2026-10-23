import { jsPDF } from "jspdf";
import { getReportEntry } from "@/app/lib/reports/report-registry";
import { getMISDetailedAgewiseArrearData } from "@/app/lib/actions/reports";
import { drawMisAgewiseArrearReport, type MisAgewiseReportType } from "@/app/lib/reports/mis-agewise-arrear-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";
import { truncateReportAmount } from "@/app/lib/utils/format-amount";
import { toDisplayDate } from '@/app/lib/date-format';

const DETAILEDWISE_HEADERS = [
  "S.No", "Branch ID", "Branch", "Centre ID", "Center", "Product Type", "Loan ID", "Loan Disbursement Date", "1st EMI Date", "Loan Maturity Date",
  "Member ID", "Member Name", "Member Nominee Name", "Address", "District", "Phone Number", "Loan Amount", "No of Installment", "Last Repay Date", "Last Repay Amount",
  "Collected Dues", "Dues Left", "Loan Age", "Age Wise", "DueDay", "EMI", "Loan Principal", "Loan Interest", "Loan Total",
  "Outstanding Principal", "Outstanding Interest", "Outstanding Total", "Overdue Principal", "Overdue Interest", "Overdue Total",
  "Opening OD Principal", "Opening OD Interest", "Opening OD Total", "Current Principal Collection", "Current Interest Collection", "Current Collection Total",
  "Principal Collection", "Interest Collection", "Closing OD Principal", "Closing OD Interest", "Closing OD Total", "Funder", "FDO Name",
];

/**
 * Request Report / Request Queue PDF renderer for "mis-agewise-arrear" —
 * reuses the exact same drawMisAgewiseArrearReport() the Direct Download
 * PDF uses (app/lib/reports/mis-agewise-arrear-pdf.ts), just with
 * Node-safe logo/font loading injected instead of the browser-only
 * defaults.
 *
 * For BRANCHWISE/CENTERWISE/FDOWISE/CLIENTWISE, reuses the report
 * registry's own fetchMisAgewiseArrear() (via getReportEntry) — verified
 * to return the exact same columns/order AND the exact same Grand Total
 * row (both Direct and the registry read the same getMISAgewiseArrearData
 * `totals` object) as Direct's own buildAgewiseArrearExportRows().
 *
 * For DETAILEDWISE, this deliberately bypasses fetchMisAgewiseArrear and
 * calls getMISDetailedAgewiseArrearData() directly: Direct's own Grand
 * Total row for this mode is built from that function's own `.totals`
 * (blank Interest cells, Total mirrored into Principal, no PAR% ratio),
 * while report-registry.ts's buildDetailedwiseRows() independently
 * re-sums the row data into a DIFFERENT-shaped totals row (real
 * Principal/Interest split plus a PAR% ratio cell) — a pre-existing
 * calculation divergence between the two, not something to silently
 * "fix" here. Since Direct PDF is this project's source of truth, this
 * queue builder replicates Direct's own totals-row construction exactly,
 * not the registry's.
 */
export async function buildMisAgewiseArrearQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate) {
    throw new Error("A report date is required for the MIS Age-wise Arrear report");
  }
  const reportType = (ctx.filters?.reportType as MisAgewiseReportType) || undefined;
  if (!reportType) {
    throw new Error("filters.reportType is required for the MIS Age-wise Arrear report (BRANCHWISE/CENTERWISE/FDOWISE/CLIENTWISE/DETAILEDWISE)");
  }

  let headers: string[];
  let rows: (string | number)[][];

  if (reportType === "DETAILEDWISE") {
    const result = await getMISDetailedAgewiseArrearData(ctx.fromDate, ctx.branchIds ?? undefined, ctx.filters?.centerId);
    headers = DETAILEDWISE_HEADERS;
    rows = result.data.map((r, idx) => [
      idx + 1, r.branchId, r.branchName, r.centreId, r.centreName, r.productType,
      r.loanId, r.loanDisbursementDate, r.firstEmiDate, r.loanMaturityDate,
      r.memberId, r.memberName, r.memberNomineeName, r.address, r.district, r.phoneNumber,
      truncateReportAmount(r.loanAmount), r.noOfInstallment, r.lastRepayDate, truncateReportAmount(r.lastRepayAmount),
      truncateReportAmount(r.collectedDues), truncateReportAmount(r.duesLeft), r.loanAge, r.ageWise, r.dueDay, truncateReportAmount(r.emi),
      truncateReportAmount(r.loanPrincipal), truncateReportAmount(r.loanInterest), truncateReportAmount(r.loanTotal),
      truncateReportAmount(r.outstandingPrincipal), truncateReportAmount(r.outstandingInterest), truncateReportAmount(r.outstandingTotal),
      truncateReportAmount(r.overduePrincipal), truncateReportAmount(r.overdueInterest), truncateReportAmount(r.overdueTotal),
      truncateReportAmount(r.openingOdPrincipal), truncateReportAmount(r.openingOdInterest), truncateReportAmount(r.openingOdTotal),
      truncateReportAmount(r.currentPrincipalCollection), truncateReportAmount(r.currentInterestCollection), truncateReportAmount(r.currentCollectionTotal),
      truncateReportAmount(r.principalCollection), truncateReportAmount(r.interestCollection),
      truncateReportAmount(r.closingOdPrincipal), truncateReportAmount(r.closingOdInterest), truncateReportAmount(r.closingOdTotal),
      r.funder, r.fdoName,
    ]);
    if (result.data.length > 0) {
      const dt = result.totals;
      rows.push([
        "—", `Grand Total (${dt.totalLoans} loans)`, "", "", "", "", "", "", "", "", "", "", "", "", "",
        truncateReportAmount(dt.totalLoanAmount),
        "", "", "", "", "", "", "", "", "",
        truncateReportAmount(dt.totalLoanAmount), "", truncateReportAmount(dt.totalLoanAmount),
        truncateReportAmount(dt.totalOutstandingPrincipal), truncateReportAmount(dt.totalOutstandingInterest), truncateReportAmount(dt.totalOutstandingTotal),
        truncateReportAmount(dt.totalOverduePrincipal), truncateReportAmount(dt.totalOverdueInterest), truncateReportAmount(dt.totalOverdueTotal),
        truncateReportAmount(dt.totalOpeningOdTotal), "", truncateReportAmount(dt.totalOpeningOdTotal),
        truncateReportAmount(dt.totalCurrentCollection), "", truncateReportAmount(dt.totalCurrentCollection),
        truncateReportAmount(dt.totalPrincipalCollection), truncateReportAmount(dt.totalInterestCollection),
        truncateReportAmount(dt.totalClosingOdTotal), "", truncateReportAmount(dt.totalClosingOdTotal),
        "", "",
      ]);
    }
  } else {
    const entry = getReportEntry("mis-agewise-arrear");
    if (!entry?.fetch) {
      throw new Error("MIS Age-wise Arrear report is not registered");
    }
    const result = await entry.fetch({
      fromDate: ctx.fromDate,
      toDate: ctx.toDate,
      branchIds: ctx.branchIds,
      filters: ctx.filters,
    });
    headers = result.headers;
    rows = result.rows;
  }

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });
  const reportFont = ensureReportFontServer(doc);

  await drawMisAgewiseArrearReport(
    doc,
    reportType,
    headers,
    rows,
    { subtitle: `Report Date: ${toDisplayDate(new Date(ctx.fromDate))}` },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
