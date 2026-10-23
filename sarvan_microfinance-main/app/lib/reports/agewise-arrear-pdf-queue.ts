import { jsPDF } from "jspdf";
import { getAgewiseArrearData } from "@/app/lib/actions/reports";
import { drawAgewiseArrearReport } from "@/app/lib/reports/agewise-arrear-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";
import { toDisplayDate } from '@/app/lib/date-format';

/**
 * Request Report / Request Queue PDF renderer for "portfolio-agewise-arrear"
 * — reuses the exact same drawAgewiseArrearReport() the Direct Download
 * PDF uses (app/lib/reports/agewise-arrear-pdf.ts), just with Node-safe
 * logo/font loading injected instead of the browser-only defaults.
 *
 * Reuses getAgewiseArrearData() from app/lib/actions/reports.ts — the
 * exact same function the live API route and report-registry.ts's
 * fetchPortfolioAgewiseArrear already call — so no figure is recalculated
 * for PDF.
 */
export async function buildAgewiseArrearQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate) {
    throw new Error("A report date is required for the Agewise Arrear report");
  }

  const centerId = ctx.filters?.centerId || "all";
  const rows = await getAgewiseArrearData(ctx.fromDate, centerId, ctx.branchIds ?? undefined);

  const doc = new jsPDF({ orientation: "landscape" });
  const reportFont = ensureReportFontServer(doc);

  await drawAgewiseArrearReport(
    doc,
    rows,
    { subtitle: `As of ${toDisplayDate(new Date(ctx.fromDate))}` },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
