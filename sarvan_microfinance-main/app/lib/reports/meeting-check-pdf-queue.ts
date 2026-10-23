import { jsPDF } from "jspdf";
import { getMeetingCheckRows } from "@/app/lib/reports/queries/batch3";
import { drawMeetingCheckReport } from "@/app/lib/reports/meeting-check-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

/**
 * Request Report / Request Queue PDF renderer for "meeting-check" — reuses
 * the exact same drawMeetingCheckReport() the Direct Download PDF uses
 * (app/lib/reports/meeting-check-pdf.ts), just with Node-safe logo/font
 * loading injected instead of the browser-only defaults.
 *
 * Reuses getMeetingCheckRows() from app/lib/reports/queries/batch3.ts — the
 * exact same shared query report-registry.ts's fetchMeetingCheck and the
 * live API route already call — so no figure is recalculated for PDF.
 */
export async function buildMeetingCheckQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate) {
    throw new Error("A report date is required for the Daily Meeting Check report");
  }

  const { data } = await getMeetingCheckRows({
    reportDate: ctx.fromDate,
    branchIds: ctx.branchIds,
    centerId: ctx.filters?.centerId ?? null,
  });

  const doc = new jsPDF({ orientation: "landscape" });
  const reportFont = ensureReportFontServer(doc);

  await drawMeetingCheckReport(doc, data, { subtitle: ctx.fromDate }, reportFont, drawPdfReportHeaderServer);

  return Buffer.from(doc.output("arraybuffer"));
}
