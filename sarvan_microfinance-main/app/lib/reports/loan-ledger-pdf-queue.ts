import { jsPDF } from "jspdf";
import { computeLoanLedgerDues } from "@/app/api/reports/client/loan-ledger-dues/route";
import { drawLoanLedgerReport } from "@/app/lib/reports/loan-ledger-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";
import { getLoanAdvanceEnabled } from "@/app/lib/loan-advance-config";

/**
 * Request Report / Request Queue PDF renderer for "loan-ledger" — reuses the
 * exact same drawLoanLedgerReport() the Direct Download PDF uses
 * (app/lib/reports/loan-ledger-pdf.ts), just with Node-safe logo/font loading
 * injected instead of the browser-only defaults.
 *
 * Reuses computeLoanLedgerDues() — newly split out of
 * GET /api/reports/client/loan-ledger-dues's inline handler as part of this
 * migration (that route previously had no exported/shared compute function).
 * The live route's role-based center-access checks (FDO/BM/AM) require a
 * request/session `user` the queue has no equivalent of, so — matching the
 * pattern report-registry.ts's own fetchLoanLedger already uses — this
 * renderer instead does the simpler `branchIds.includes(result.branchId)`
 * check against the queue's already-permission-resolved branchIds. This is a
 * pre-existing pattern in this codebase, not something new introduced here.
 * report-registry.ts's fetchLoanLedger (a separate, narrower 12-column
 * implementation used for Excel/CSV) is untouched by this migration.
 */
export async function buildLoanLedgerQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  const { loanId, centerId, clientId } = ctx.filters ?? {};
  if (!loanId || !centerId || !clientId) {
    throw new Error("filters.loanId, filters.centerId and filters.clientId are required for the Loan Ledger report");
  }

  const result = await computeLoanLedgerDues(loanId, clientId, centerId);
  if (!result) {
    throw new Error("Loan not found");
  }
  if (ctx.branchIds && (!result.branchId || !ctx.branchIds.includes(result.branchId))) {
    throw new Error("Unauthorized center access");
  }

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const reportFont = ensureReportFontServer(doc);
  const loanAdvanceEnabled = await getLoanAdvanceEnabled();

  await drawLoanLedgerReport(doc, result, reportFont, drawPdfReportHeaderServer, loanAdvanceEnabled);

  return Buffer.from(doc.output("arraybuffer"));
}
