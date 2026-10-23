import { jsPDF } from "jspdf";
import { getReportEntry } from "@/app/lib/reports/report-registry";
import { drawAttendanceSummaryReport } from "@/app/lib/reports/attendance-summary-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

/**
 * Request Report / Request Queue PDF renderer for "attendance-summary" —
 * reuses the exact same drawAttendanceSummaryReport() the Direct Download
 * PDF uses (app/lib/reports/attendance-summary-pdf.ts), just with Node-safe
 * logo/font loading injected instead of the browser-only defaults.
 *
 * Reuses the report registry's own fetchAttendanceSummary() (via
 * getReportEntry) for row data — the exact same adapter already used for
 * this report's Excel/CSV/Word queue exports, whose row shape already
 * matches the Direct PDF's row shape exactly. Direct's PDF appends a
 * trailing "Grand Total" row that fetchAttendanceSummary itself doesn't
 * include; it's added here the same way Direct builds it — summing the
 * already-fetched columns, not a new query.
 */
export async function buildAttendanceSummaryQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate || !ctx.toDate) {
    throw new Error("fromDate and toDate are required for the Attendance Summary report");
  }

  const entry = getReportEntry("attendance-summary");
  if (!entry?.fetch) {
    throw new Error("Attendance Summary report is not registered");
  }
  const { headers, rows } = await entry.fetch({
    fromDate: ctx.fromDate,
    toDate: ctx.toDate,
    branchIds: ctx.branchIds,
    filters: ctx.filters,
  });

  const sum = (colIndex: number) => rows.reduce((s, r) => s + Number(r[colIndex] ?? 0), 0);
  rows.push(["", "Grand Total", sum(2), sum(3), sum(4), sum(5)]);

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const reportFont = ensureReportFontServer(doc);

  await drawAttendanceSummaryReport(
    doc,
    { headers, rows },
    { subtitle: `${ctx.fromDate} to ${ctx.toDate}` },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
