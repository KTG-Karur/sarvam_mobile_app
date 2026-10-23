import { jsPDF } from "jspdf";
import { computeCenterMasterSummary } from "@/app/api/reports/portfolio/center-master/route";
import { drawCenterMasterSummaryReport } from "@/app/lib/reports/center-master-summary-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

/**
 * Request Report / Request Queue PDF renderer for "center-master-summary" —
 * reuses the exact same drawCenterMasterSummaryReport() the Direct Download
 * PDF uses (app/lib/reports/center-master-summary-pdf.ts), just with
 * Node-safe logo/font loading injected instead of the browser-only defaults.
 *
 * Reuses computeCenterMasterSummary() — newly split out of
 * GET /api/reports/portfolio/center-master's inline handler as part of this
 * migration (that route previously had no exported/shared compute function).
 * report-registry.ts's fetchCenterMasterSummary (a separate, independently
 * duplicated implementation used for Excel/CSV/Word) is untouched by this
 * migration.
 */
export async function buildCenterMasterSummaryQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate) {
    throw new Error("A report date is required for the Center Master Summary report");
  }
  if (!ctx.branchIds || ctx.branchIds.length !== 1) {
    throw new Error("Select exactly one branch for the Center Master Summary report");
  }
  const branchId = ctx.branchIds[0];

  const data = await computeCenterMasterSummary(branchId, ctx.fromDate);

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });
  const reportFont = ensureReportFontServer(doc);

  await drawCenterMasterSummaryReport(
    doc,
    data,
    { subtitle: `Date: ${ctx.fromDate}` },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
