import { jsPDF } from "jspdf";
import { getBranchDemandDataCore } from "@/app/lib/actions/branch-demand";
import { drawBranchDemandReport } from "@/app/lib/reports/branch-demand-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";
import { getLoanAdvanceEnabled } from "@/app/lib/loan-advance-config";

/**
 * Request Report / Request Queue PDF renderer for "branch-demand" — reuses
 * the exact same drawBranchDemandReport() the Direct Download PDF uses
 * (app/lib/reports/branch-demand-pdf.ts), just with Node-safe logo/font
 * loading injected instead of the browser-only defaults.
 *
 * Reuses getBranchDemandDataCore() from app/lib/actions/branch-demand.ts —
 * the "cookie-free core" already shared with the live Server Action and
 * report-registry.ts's fetchBranchDemandField — so no query is
 * recalculated for PDF. The GRAND TOTAL row is computed here by summing the
 * already-fetched rows (the same approach word/options/branch-demand.ts
 * already uses), not via getBranchDemandTotals() — that helper re-derives
 * its own session-authenticated data and has no session context here.
 */
export async function buildBranchDemandQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate) {
    throw new Error("A demand date is required for the Branch Demand report");
  }
  const centerId = ctx.filters?.centerId || "all";

  const result = await getBranchDemandDataCore(ctx.fromDate, 1, 999999, ctx.branchIds, centerId);

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const reportFont = ensureReportFontServer(doc);

  await drawBranchDemandReport(
    doc,
    result.data,
    { subtitle: `Demand Date: ${ctx.fromDate}` },
    reportFont,
    drawPdfReportHeaderServer,
    await getLoanAdvanceEnabled()
  );

  return Buffer.from(doc.output("arraybuffer"));
}
