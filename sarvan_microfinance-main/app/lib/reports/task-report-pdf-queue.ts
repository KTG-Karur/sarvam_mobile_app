import { jsPDF } from "jspdf";
import { getReportEntry } from "@/app/lib/reports/report-registry";
import { drawTaskReportReport } from "@/app/lib/reports/task-report-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

/**
 * Request Report / Request Queue PDF renderer for "task-report" — reuses the
 * exact same drawTaskReportReport() the Direct Download PDF uses
 * (app/lib/reports/task-report-pdf.ts), just with Node-safe logo/font loading
 * injected instead of the browser-only defaults.
 *
 * Reuses the report registry's own fetchTaskReport() (via getReportEntry) for
 * row data — the exact same adapter already used for this report's Excel/CSV
 * queue exports, itself backed by computeTaskReport() (shared with the live
 * GET /api/reports/employee/task-report route) — so no query or figure is
 * recalculated for PDF.
 */

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export async function buildTaskReportQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  const month = ctx.filters?.month ? parseInt(ctx.filters.month, 10) : NaN;
  const year = ctx.filters?.year ? parseInt(ctx.filters.year, 10) : NaN;
  if (isNaN(month) || month < 1 || month > 12 || isNaN(year)) {
    throw new Error("filters.month (1-12) and filters.year are required for the FDO Task Report");
  }

  const entry = getReportEntry("task-report");
  if (!entry?.fetch) {
    throw new Error("FDO Task Report is not registered");
  }
  const { headers, rows } = await entry.fetch({
    fromDate: ctx.fromDate,
    toDate: ctx.toDate,
    branchIds: ctx.branchIds,
    filters: ctx.filters,
  });

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });
  const reportFont = ensureReportFontServer(doc);

  await drawTaskReportReport(
    doc,
    { headers, rows },
    { subtitle: `${MONTH_LABELS[month - 1]} ${year}` },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
