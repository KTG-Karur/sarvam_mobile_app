import { jsPDF } from "jspdf";
import { getPreclosureRows } from "@/app/lib/reports/queries/batch2";
import { drawPreclosureReport } from "@/app/lib/reports/preclosure-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";
import { toDisplayDate } from '@/app/lib/date-format';

/**
 * Request Report / Request Queue PDF renderer for "preclosure" — reuses
 * the exact same drawPreclosureReport() the Direct Download PDF uses
 * (app/lib/reports/preclosure-pdf.ts), just with Node-safe logo/font
 * loading injected instead of the browser-only defaults.
 *
 * Reuses getPreclosureRows() from app/lib/reports/queries/batch2.ts — the
 * exact same shared query report-registry.ts's fetchPreclosure and the
 * live API route already call — so no figure is recalculated for PDF.
 */
export async function buildPreclosureQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate || !ctx.toDate) {
    throw new Error("fromDate and toDate are required for the Preclosure report");
  }

  const rows = await getPreclosureRows({
    fromDate: ctx.fromDate,
    toDate: ctx.toDate,
    branchIds: ctx.branchIds,
    centerId: ctx.filters?.centerId ?? null,
  });

  const doc = new jsPDF({ orientation: "landscape" });
  const reportFont = ensureReportFontServer(doc);

  await drawPreclosureReport(
    doc,
    rows,
    { subtitle: `Period: ${toDisplayDate(new Date(ctx.fromDate))} to ${toDisplayDate(new Date(ctx.toDate))}` },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
