import { jsPDF } from "jspdf";
import { getGoldReturnedReport, type GoldReturnedRow, type GoldReturnedTotals } from "@/app/lib/actions/reports";
import { drawGoldReportPdf } from "@/app/lib/reports/gold-report-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";
import { truncateReportAmount } from "@/app/lib/utils/format-amount";

function buildGoldReturnedExportRows(rows: GoldReturnedRow[], totals: GoldReturnedTotals): { headers: (string | number)[]; rows: (string | number)[][] } {
  const headers = [
    "S.No", "Branch ID", "Branch Name", "Centre ID", "Center Name",
    "Product Type", "Loan Product", "Loan ID", "Member ID", "Member Name",
    "Aadhaar Number", "Phone Number", "Loan Cycle", "FDO Name",
    "Purpose Of Loan", "Loan Index ID", "LD Date", "LD Time",
    "Start Date", "End Date", "Loan Principal", "Loan Interest",
    "Loan Total Amount", "Gold Weight (g)", "Gold Value on Disbursement",
    "Funding Name", "Loan Status", "Loan Approve", "Return Date", "Hand Over To",
    "Item", "Reference No.", "Remark",
  ];
  const exportRows = rows.map((r) => [
    r.sNo, r.branchId, r.branchName, r.centreId, r.centerName,
    r.productType, r.loanProduct, r.loanId, r.memberId, r.memberName,
    r.aadhaarNumber, r.phoneNumber, r.loanCycle, r.fdoName,
    r.purposeOfLoan, r.loanIndexId, r.ldDate, r.ldTime,
    r.startDate, r.endDate, truncateReportAmount(r.loanPrincipal), truncateReportAmount(r.loanInterest),
    truncateReportAmount(r.loanTotalAmount), r.goldWeight, truncateReportAmount(r.goldValueOnDisbursement),
    r.fundingName, r.loanStatus, r.loanApprove, r.returnDate, r.handOverTo,
    r.itemDescription, r.goldTokenNo, r.remarks,
  ]);

  if (rows.length > 0) {
    exportRows.push([
      `TOTAL (${rows.length} records)`, "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "",
      truncateReportAmount(totals.loanPrincipal), truncateReportAmount(totals.loanInterest), truncateReportAmount(totals.loanTotalAmount),
      Number(totals.goldWeight.toFixed(3)), truncateReportAmount(totals.goldValueOnDisbursement),
      "", "", "", "", "", "", "", "",
    ]);
  }

  return { headers, rows: exportRows };
}

/**
 * Request Report / Request Queue PDF renderer for "gold-returned" —
 * reuses the exact same drawGoldReportPdf() the Direct Download PDF uses
 * (app/lib/reports/gold-report-pdf.ts), just with Node-safe logo/font
 * loading injected instead of the browser-only defaults.
 *
 * Calls getGoldReturnedReport() directly (app/lib/actions/reports.ts)
 * with the same page-looping pattern as Direct's own
 * fetchAllReturnedForExport() (the server action clamps pageSize to 5000)
 * — bypassing report-registry.ts's fetchGoldReturned. As of Batch 4B,
 * fetchGoldReturned's 33-column shape (incl. Item/Reference No./Remark)
 * and Total row now match this PDF path's own output, but PDF still calls
 * getGoldReturnedReport directly rather than reusing fetchGoldReturned, to
 * keep this bespoke renderer independent of report-registry.ts.
 */
export async function buildGoldReturnedQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate || !ctx.toDate) {
    throw new Error("fromDate and toDate are required for the Gold Returned report");
  }
  const centerId = ctx.filters?.centerId;

  // preResolvedBranchIds must be passed explicitly (even as null for "all branches") —
  // this queue worker has no cookie session, and leaving it undefined would make
  // getGoldReturnedReport fall back to the cookie-based getServerActionUser() lookup,
  // which throws "Authentication required" outside a request context.
  const first = await getGoldReturnedReport(ctx.fromDate, ctx.toDate, undefined, centerId, 1, 5000, ctx.branchIds);
  const rows = [...first.rows];
  for (let page = 2; page <= first.totalPages; page++) {
    const next = await getGoldReturnedReport(ctx.fromDate, ctx.toDate, undefined, centerId, page, 5000, ctx.branchIds);
    rows.push(...next.rows);
  }

  const { headers, rows: body } = buildGoldReturnedExportRows(rows, first.totals);

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const reportFont = ensureReportFontServer(doc);

  await drawGoldReportPdf(doc, "Gold Returned Report", headers, body, { subtitle: `From ${ctx.fromDate} to ${ctx.toDate}` }, reportFont, drawPdfReportHeaderServer);

  return Buffer.from(doc.output("arraybuffer"));
}
