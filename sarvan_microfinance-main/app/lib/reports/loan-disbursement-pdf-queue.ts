import { jsPDF } from "jspdf";
import { getReportEntry } from "@/app/lib/reports/report-registry";
import { drawLoanDisbursementReport } from "@/app/lib/reports/loan-disbursement-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

/**
 * Request Report / Request Queue PDF renderer for "loan-disbursement" —
 * reuses the exact same drawLoanDisbursementReport() the Direct Download PDF
 * uses (app/lib/reports/loan-disbursement-pdf.ts), just with Node-safe
 * logo/font loading injected instead of the browser-only defaults.
 *
 * Reuses the report registry's own fetchLoanDisbursement() (via
 * getReportEntry) for row data — the exact same adapter already used for
 * this report's Excel/CSV/Word queue exports, itself backed by
 * getLoanDisbursementData() (shared with the live GET route) — its 39-column
 * shape already matches the Direct PDF's row shape exactly, so no query or
 * figure is recalculated for PDF. Direct's PDF appends a trailing "Grand
 * Total" row that fetchLoanDisbursement itself doesn't include; it's added
 * here the same way Direct builds it — summing the already-fetched Number Of
 * Installments / Loan Principal columns, not a new query.
 */
export async function buildLoanDisbursementQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate || !ctx.toDate) {
    throw new Error("fromDate and toDate are required for the Loan Disbursement report");
  }

  const entry = getReportEntry("loan-disbursement");
  if (!entry?.fetch) {
    throw new Error("Loan Disbursement report is not registered");
  }
  const { headers, rows } = await entry.fetch({
    fromDate: ctx.fromDate,
    toDate: ctx.toDate,
    branchIds: ctx.branchIds,
    filters: ctx.filters,
  });

  if (rows.length > 0) {
    const totalLoans = rows.length;
    const totalDues = rows.reduce((sum, r) => sum + Number(r[29] || 0), 0);
    const totalAmount = rows.reduce((sum, r) => sum + Number(r[31] || 0), 0);
    rows.push([
      "", `Grand Total (${totalLoans} loans)`, "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "",
      "", "", "", "", "", "", totalDues, "", totalAmount, "", "", "", "", "", "", "", "",
    ]);
  }

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });
  const reportFont = ensureReportFontServer(doc);

  await drawLoanDisbursementReport(
    doc,
    { headers, rows },
    { subtitle: `${ctx.fromDate} to ${ctx.toDate}` },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
