import { jsPDF } from "jspdf";
import { format } from "date-fns";
import { prisma } from "@/app/lib/db";
import { getArrearDemandSheetDataCore } from "@/app/lib/actions/demand";
import { drawArrearDemandSheetReport } from "@/app/lib/reports/arrear-demand-sheet-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

/**
 * Request Report / Request Queue PDF renderer for "arrear-demand-sheet" —
 * reuses the exact same drawArrearDemandSheetReport() the Direct Download
 * PDF uses (app/lib/reports/arrear-demand-sheet-pdf.ts), just with Node-safe
 * logo/font loading injected instead of the browser-only defaults.
 *
 * Reuses getArrearDemandSheetDataCore() from app/lib/actions/demand.ts — the
 * exact same function both the live Server Action and
 * report-registry.ts's fetchArrearDemandSheet already call — so no query or
 * figure is recalculated for PDF. The branch-scoping check mirrors
 * fetchArrearDemandSheet's own (report-registry.ts).
 */
export async function buildArrearDemandSheetQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  const centerId = ctx.filters?.centerId;
  if (!centerId) {
    throw new Error("centerId is required for the Arrear Demand Sheet report");
  }
  if (!ctx.fromDate) {
    throw new Error("An arrear date is required for the Arrear Demand Sheet report");
  }

  if (ctx.branchIds) {
    const center = await prisma.center.findUnique({ where: { id: centerId }, select: { branchId: true } });
    if (!center || !ctx.branchIds.includes(center.branchId)) {
      throw new Error("You do not have access to this center");
    }
  }

  const { rows, meta } = await getArrearDemandSheetDataCore(ctx.fromDate, centerId);
  const dateFormatted = format(new Date(`${ctx.fromDate}T00:00:00`), "dd/MM/yyyy");

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const reportFont = ensureReportFontServer(doc);

  await drawArrearDemandSheetReport(doc, rows, meta, dateFormatted, reportFont, drawPdfReportHeaderServer);

  return Buffer.from(doc.output("arraybuffer"));
}
