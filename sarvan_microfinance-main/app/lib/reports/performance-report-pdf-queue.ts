import { jsPDF } from "jspdf";
import { getReportEntry } from "@/app/lib/reports/report-registry";
import { drawPerformanceReport } from "@/app/lib/reports/performance-report-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";
import { toDisplayDate } from '@/app/lib/date-format';

/**
 * Request Report / Request Queue PDF renderer for "performance-report" —
 * reuses the exact same drawPerformanceReport() the Direct Download PDF
 * uses (app/lib/reports/performance-report-pdf.ts), just with Node-safe
 * logo/font loading injected instead of the browser-only defaults.
 *
 * Reuses the report registry's own fetchPerformanceReport() (via
 * getReportEntry) — it already appends the identical TOTAL row Direct's
 * own buildPerformanceExportRows() computes (confirmed by
 * word/options/performance-report.ts's precedent), so `rows` is passed
 * straight through with no server-side recomputation.
 */
export async function buildPerformanceReportQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate || !ctx.toDate) {
    throw new Error("fromDate and toDate are required for the Performance report");
  }

  const entry = getReportEntry("performance-report");
  if (!entry?.fetch) {
    throw new Error("Performance report is not registered");
  }
  const { headers, rows } = await entry.fetch({
    fromDate: ctx.fromDate,
    toDate: ctx.toDate,
    branchIds: ctx.branchIds,
    filters: ctx.filters,
  });

  const doc = new jsPDF({ orientation: "landscape" });
  const reportFont = ensureReportFontServer(doc);

  await drawPerformanceReport(
    doc,
    headers,
    rows,
    {
      reportType: ctx.filters?.reportType,
      subtitle: `Period: ${toDisplayDate(new Date(ctx.fromDate))} to ${toDisplayDate(new Date(ctx.toDate))}`,
    },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
