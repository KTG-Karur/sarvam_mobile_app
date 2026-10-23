import { jsPDF } from "jspdf";
import { getMISBranchDemandData } from "@/app/lib/actions/reports";
import { drawMisBranchDemandReport } from "@/app/lib/reports/mis-branch-demand-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

/**
 * Request Report / Request Queue PDF renderer for "mis-branch-demand" —
 * reuses the exact same drawMisBranchDemandReport() the Direct Download
 * PDF uses (app/lib/reports/mis-branch-demand-pdf.ts), just with Node-safe
 * logo/font loading injected instead of the browser-only defaults.
 *
 * Reuses getMISBranchDemandData() from app/lib/actions/reports.ts — the
 * exact same function the live API route and report-registry.ts's
 * fetchMisBranchDemand already call — so no figure is recalculated for
 * PDF, and its already-computed `totals` is reused for the TOTAL row
 * rather than re-summing (unlike branch-demand-pdf-queue.ts's workaround,
 * which had to sum manually because that report's core fetcher has no
 * totals).
 */
export async function buildMisBranchDemandQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate || !ctx.toDate) {
    throw new Error("fromDate and toDate are required for the MIS Branch Demand report");
  }

  const result = await getMISBranchDemandData(ctx.fromDate, ctx.toDate, ctx.branchIds ?? undefined);

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const reportFont = ensureReportFontServer(doc);

  await drawMisBranchDemandReport(
    doc,
    result.data,
    result.totals,
    { fromDate: ctx.fromDate, toDate: ctx.toDate },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
