import { jsPDF } from "jspdf";
import { computeLoanIndexReport } from "@/app/api/reports/others/loan-index/route";
import { drawLoanIndexReport } from "@/app/lib/reports/loan-index-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

/**
 * Request Report / Request Queue PDF renderer for "loan-index" — reuses the
 * exact same drawLoanIndexReport() the Direct Download PDF uses
 * (app/lib/reports/loan-index-pdf.ts), just with Node-safe logo/font loading
 * injected instead of the browser-only defaults.
 *
 * Reuses computeLoanIndexReport() — newly split out of
 * GET /api/reports/others/loan-index's inline handler as part of this
 * migration (that route previously had no exported/shared compute function,
 * unlike GL All/GL One/Receipts & Payments) — so both the live route and this
 * queue renderer now share one implementation instead of the three
 * independent ones the audit found (live route, this new export, and
 * report-registry.ts's separate fetchLoanIndex, which remains untouched and
 * keeps serving Excel/CSV/Word with its own slightly different field set).
 */
export async function buildLoanIndexQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  const indexId = ctx.filters?.indexId;
  if (!indexId) {
    throw new Error("filters.indexId is required for the Loan Index report");
  }

  const result = await computeLoanIndexReport(indexId);
  if (!result) {
    throw new Error("Loan Index not found");
  }
  if (ctx.branchIds && !ctx.branchIds.includes(result.branchId)) {
    throw new Error("Loan Index not found");
  }

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const reportFont = ensureReportFontServer(doc);

  await drawLoanIndexReport(doc, result.reportData, reportFont, drawPdfReportHeaderServer);

  return Buffer.from(doc.output("arraybuffer"));
}
