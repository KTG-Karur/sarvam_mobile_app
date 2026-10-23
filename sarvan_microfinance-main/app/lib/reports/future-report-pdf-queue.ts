import { jsPDF } from "jspdf";
import { getFutureReportRows } from "@/app/lib/reports/queries/batch4";
import { drawFutureReport } from "@/app/lib/reports/future-report-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";
import { truncateReportAmount } from "@/app/lib/utils/format-amount";

function formatFutureReportDate(dateStr: string): string {
  if (!dateStr || dateStr === "N/A") return "N/A";
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Request Report / Request Queue PDF renderer for "future-report" —
 * reuses the exact same drawFutureReport() the Direct Download PDF uses
 * (app/lib/reports/future-report-pdf.ts), just with Node-safe logo/font
 * loading injected instead of the browser-only defaults.
 *
 * Calls getFutureReportRows() directly (app/lib/reports/queries/batch4.ts)
 * — the exact same function both the live API route and
 * report-registry.ts's fetchFutureReport call — bypassing that registry
 * wrapper only to access the already-computed `result.totals` it
 * currently discards, so the TOTAL row is built from data already
 * fetched, never a new query, mirroring Direct's own
 * fetchFutureReportExportRows().
 */
export async function buildFutureReportQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate || !ctx.toDate) {
    throw new Error("fromDate and toDate are required for the Future Report");
  }

  const result = await getFutureReportRows({
    fromDate: ctx.fromDate,
    toDate: ctx.toDate,
    branchIds: ctx.branchIds,
    centerId: ctx.filters?.centerId,
    page: 1,
    pageSize: 1_000_000,
  });

  const headers = [
    "S.No", "Branch ID", "Branch Name", "Centre ID", "Center Name",
    "FDO Name", "Loan ID", "Member Unique ID", "Member Name", "Member Phone",
    "Member Aadhar", "Meetup Time", "Disbursement Date", "1st EMI Date",
    "Loan Maturity Date", "Loan Amount", "Outstanding Principal", "Outstanding Interest",
    "Outstanding Total Amount", "Due Date", "Due No", "Due Principal",
    "Due Interest", "Total Due Amount", "Funder Name",
  ];
  const rows: (string | number)[][] = result.data.map((r) => [
    r.sNo, r.branchId, r.branchName, r.centreId, r.centerName, r.fdoName, r.loanId,
    r.memberUniqueId, r.memberName, r.memberPhone, r.memberAadhar, r.meetupTime,
    formatFutureReportDate(r.disbursementDate), formatFutureReportDate(r.firstEmiDate), formatFutureReportDate(r.loanMaturityDate),
    truncateReportAmount(r.loanAmount), truncateReportAmount(r.outstandingPrincipal), truncateReportAmount(r.outstandingInterest), truncateReportAmount(r.outstandingTotal),
    formatFutureReportDate(r.dueDate), r.dueNo, truncateReportAmount(r.duePrincipal), truncateReportAmount(r.dueInterest), truncateReportAmount(r.totalDueAmount), r.funderName,
  ]);

  if (result.totals) {
    const t = result.totals;
    rows.push([
      "TOTAL", "", "", "", "", "", "", "", "", "", "", "", "", "", "",
      truncateReportAmount(t.loanAmount), truncateReportAmount(t.outstandingPrincipal), truncateReportAmount(t.outstandingInterest), truncateReportAmount(t.outstandingTotal),
      "", "", truncateReportAmount(t.duePrincipal), truncateReportAmount(t.dueInterest), truncateReportAmount(t.totalDueAmount), "",
    ]);
  }

  const doc = new jsPDF({ orientation: "landscape" });
  const reportFont = ensureReportFontServer(doc);

  await drawFutureReport(
    doc,
    headers,
    rows,
    { subtitle: `From ${formatFutureReportDate(ctx.fromDate)} to ${formatFutureReportDate(ctx.toDate)}` },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
