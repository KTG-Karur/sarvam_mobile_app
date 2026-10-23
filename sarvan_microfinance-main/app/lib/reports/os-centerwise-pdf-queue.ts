import { jsPDF } from "jspdf";
import { getOSCenterwiseData } from "@/app/lib/actions/reports";
import { drawOsCenterwiseReport } from "@/app/lib/reports/os-centerwise-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";
import { toDisplayDate } from '@/app/lib/date-format';

/**
 * Request Report / Request Queue PDF renderer for "os-centerwise" — reuses
 * the exact same drawOsCenterwiseReport() the Direct Download PDF uses
 * (app/lib/reports/os-centerwise-pdf.ts), just with Node-safe logo/font
 * loading injected instead of the browser-only defaults.
 *
 * Reuses getOSCenterwiseData() from app/lib/actions/reports.ts — the exact
 * same function the live API route and report-registry.ts's
 * fetchOSCenterwise already call — so no figure is recalculated for PDF,
 * and its already-computed `totals` is reused for the TOTAL row rather
 * than re-summing.
 */
export async function buildOsCenterwiseQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate) {
    throw new Error("A report date is required for the Loan OS Center report");
  }

  const result = await getOSCenterwiseData(ctx.fromDate, ctx.branchIds ?? undefined);

  const doc = new jsPDF({ orientation: "landscape" });
  const reportFont = ensureReportFontServer(doc);

  await drawOsCenterwiseReport(
    doc,
    result.data,
    result.totals,
    { subtitle: `As of ${toDisplayDate(new Date(ctx.fromDate))}` },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
