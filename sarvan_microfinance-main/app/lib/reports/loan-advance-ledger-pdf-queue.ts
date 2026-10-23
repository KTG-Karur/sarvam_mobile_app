import { jsPDF } from "jspdf";
import { getReportEntry } from "@/app/lib/reports/report-registry";
import { drawLoanAdvanceLedgerReport } from "@/app/lib/reports/loan-advance-ledger-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

/**
 * Request Report / Request Queue PDF renderer for "loan-advance-ledger" —
 * reuses the exact same drawLoanAdvanceLedgerReport() the Direct Download
 * PDF uses (app/lib/reports/loan-advance-ledger-pdf.ts), just with
 * Node-safe logo/font loading injected instead of the browser-only
 * defaults.
 *
 * Reuses the report registry's own fetchLoanAdvanceLedger() (via
 * getReportEntry) — it already returns the exact same 13 columns/order,
 * the same client-summary + transaction-continuation row shape, AND the
 * same trailing GRAND TOTAL row Direct's own buildLoanAdvanceExportRows()
 * computes, so `rows` is passed straight through with no recomputation.
 */
export async function buildLoanAdvanceLedgerQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  const entry = getReportEntry("loan-advance-ledger");
  if (!entry?.fetch) {
    throw new Error("Loan Advance Ledger report is not registered");
  }
  const { headers, rows } = await entry.fetch({
    fromDate: ctx.fromDate,
    toDate: ctx.toDate,
    branchIds: ctx.branchIds,
    filters: ctx.filters,
  });

  const doc = new jsPDF({ orientation: "landscape" });
  const reportFont = ensureReportFontServer(doc);

  await drawLoanAdvanceLedgerReport(doc, headers, rows, reportFont, drawPdfReportHeaderServer);

  return Buffer.from(doc.output("arraybuffer"));
}
