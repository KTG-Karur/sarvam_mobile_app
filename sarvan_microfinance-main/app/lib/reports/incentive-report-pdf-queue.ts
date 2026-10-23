import { jsPDF } from "jspdf";
import { getIncentiveReportData } from "@/app/lib/services/incentive-report.service";
import { drawIncentiveReport } from "@/app/lib/reports/incentive-report-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

/**
 * Request Report / Request Queue PDF renderer for "incentive-report" — reuses
 * the exact same drawIncentiveReport() the Direct Download PDF uses
 * (app/lib/reports/incentive-report-pdf.ts), just with Node-safe logo/font
 * loading injected instead of the browser-only defaults.
 *
 * Reuses getIncentiveReportData() from
 * app/lib/services/incentive-report.service.ts — the exact same function
 * both the live GET route and report-registry.ts's fetchIncentiveReport
 * already call — so no query or figure is recalculated for PDF.
 */
export async function buildIncentiveReportQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate || !ctx.toDate) {
    throw new Error("fromDate and toDate are required for the Incentive Report");
  }

  const result = await getIncentiveReportData({
    fromDate: ctx.fromDate,
    toDate: ctx.toDate,
    scopedBranchIds: ctx.branchIds,
    branchId: ctx.filters?.branchId,
    divisionId: ctx.filters?.divisionId,
    fdoId: ctx.filters?.fdoId,
    search: ctx.filters?.search,
    exportAll: true,
  });

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });
  const reportFont = ensureReportFontServer(doc);

  await drawIncentiveReport(
    doc,
    result.data,
    {
      fromDate: ctx.fromDate,
      toDate: ctx.toDate,
      fieldOfficerCount: result.data.length,
      totalFinalIncentive: result.summary.totalFinalIncentive,
    },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
