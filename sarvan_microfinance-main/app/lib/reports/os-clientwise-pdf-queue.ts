import { jsPDF } from "jspdf";
import { getOSClientwiseData } from "@/app/lib/actions/reports";
import { drawOsClientwiseReport } from "@/app/lib/reports/os-clientwise-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

/**
 * Request Report / Request Queue PDF renderer for "os-clientwise-admin" —
 * reuses the exact same drawOsClientwiseReport() the Direct Download PDF
 * uses (app/lib/reports/os-clientwise-pdf.ts), just with Node-safe
 * logo/font loading injected instead of the browser-only defaults.
 *
 * Reuses getOSClientwiseData() from app/lib/actions/reports.ts — the exact
 * same function the live API route and report-registry.ts's
 * fetchOSClientwiseCore (shared with the sibling "loan-os-client" slug)
 * already call — so no figure is recalculated for PDF.
 */
export async function buildOsClientwiseQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate) {
    throw new Error("A report date is required for the OS Clientwise report");
  }

  const result = await getOSClientwiseData(
    ctx.fromDate, 1, 0,
    { centerId: ctx.filters?.centerId, funderId: ctx.filters?.funderId, search: undefined, branchId: ctx.branchIds ?? undefined },
    true
  );

  const doc = new jsPDF({ orientation: "landscape" });
  const reportFont = ensureReportFontServer(doc);

  await drawOsClientwiseReport(doc, result.data, { subtitle: `As on ${ctx.fromDate}` }, reportFont, drawPdfReportHeaderServer);

  return Buffer.from(doc.output("arraybuffer"));
}
