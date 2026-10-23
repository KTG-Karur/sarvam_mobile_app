import { jsPDF } from "jspdf";
import { getDropoutsRows } from "@/app/lib/reports/queries/batch1";
import { drawDropoutsReport } from "@/app/lib/reports/dropouts-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

/**
 * Request Report / Request Queue PDF renderer for "dropouts" — reuses the
 * exact same drawDropoutsReport() the Direct Download PDF uses
 * (app/lib/reports/dropouts-pdf.ts), just with Node-safe logo/font loading
 * injected instead of the browser-only defaults.
 *
 * Reuses getDropoutsRows() from app/lib/reports/queries/batch1.ts — the
 * exact same shared query report-registry.ts's fetchDropouts and the live
 * API route already call — so no figure is recalculated for PDF.
 */
export async function buildDropoutsQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate || !ctx.toDate) {
    throw new Error("fromDate and toDate are required for the Dropouts report");
  }

  const rows = await getDropoutsRows({
    fromDate: ctx.fromDate,
    toDate: ctx.toDate,
    branchIds: ctx.branchIds,
    centerId: ctx.filters?.centerId ?? null,
  });

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const reportFont = ensureReportFontServer(doc);

  await drawDropoutsReport(doc, rows, reportFont, drawPdfReportHeaderServer);

  return Buffer.from(doc.output("arraybuffer"));
}
