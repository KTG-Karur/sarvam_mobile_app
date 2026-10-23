import { jsPDF } from "jspdf";
import { getReportEntry } from "@/app/lib/reports/report-registry";
import { drawLoanSavingsReport } from "@/app/lib/reports/loan-savings-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

/**
 * Request Report / Request Queue PDF renderer for "loan-savings" — reuses
 * the exact same drawLoanSavingsReport() the Direct Download PDF uses
 * (app/lib/reports/loan-savings-pdf.ts), just with Node-safe logo/font
 * loading injected instead of the browser-only defaults.
 *
 * Reuses the report registry's own fetchLoanSavings() (via getReportEntry)
 * — it already returns the exact same 15 columns/order AND the same
 * trailing TOTAL row Direct's own buildLoanAdvanceExportRows() computes,
 * so `rows` is passed straight through with no recomputation.
 */
export async function buildLoanSavingsQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  const entry = getReportEntry("loan-savings");
  if (!entry?.fetch) {
    throw new Error("Loan Savings report is not registered");
  }
  const { headers, rows } = await entry.fetch({
    fromDate: ctx.fromDate,
    toDate: ctx.toDate,
    branchIds: ctx.branchIds,
    filters: ctx.filters,
  });

  const doc = new jsPDF({ orientation: "landscape" });
  const reportFont = ensureReportFontServer(doc);

  await drawLoanSavingsReport(doc, headers, rows, reportFont, drawPdfReportHeaderServer);

  return Buffer.from(doc.output("arraybuffer"));
}
