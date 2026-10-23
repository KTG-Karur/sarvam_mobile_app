import { jsPDF } from "jspdf";
import { getReportEntry } from "@/app/lib/reports/report-registry";
import { drawFdoPerformanceReport } from "@/app/lib/reports/fdo-performance-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

/**
 * Request Report / Request Queue PDF renderer for "fdo-performance" —
 * reuses the exact same drawFdoPerformanceReport() the Direct Download PDF
 * uses (app/lib/reports/fdo-performance-pdf.ts), just with Node-safe
 * logo/font loading injected instead of the browser-only defaults.
 *
 * Reuses the report registry's own fetchFdoPerformance() (via
 * getReportEntry) — the exact same getFdoPerformanceRows() the live API
 * route calls — for row data. fetchFdoPerformance's ReportRows has no
 * trailing TOTAL row (unlike Direct's own buildFdoPerformanceExportRows()),
 * so it's recomputed here by summing the already-fetched rows' numeric
 * columns (3-19) — never via a new query — mirroring the same workaround
 * already used by this report's Word queue export.
 */
export async function buildFdoPerformanceQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate || !ctx.toDate) {
    throw new Error("fromDate and toDate are required for the FDO Performance report");
  }

  const entry = getReportEntry("fdo-performance");
  if (!entry?.fetch) {
    throw new Error("FDO Performance report is not registered");
  }
  const { headers, rows } = await entry.fetch({
    fromDate: ctx.fromDate,
    toDate: ctx.toDate,
    branchIds: ctx.branchIds,
    filters: ctx.filters,
  });

  const body = rows.slice();
  if (rows.length > 0) {
    const sum = (colIndex: number) => rows.reduce((s, r) => s + Number(r[colIndex] ?? 0), 0);
    const totalRow: (string | number)[] = ["", "", "TOTAL:"];
    for (let i = 3; i < headers.length; i++) totalRow.push(sum(i));
    body.push(totalRow);
  }

  const doc = new jsPDF({ orientation: "landscape" });
  const reportFont = ensureReportFontServer(doc);

  await drawFdoPerformanceReport(doc, headers, body, { subtitle: `${ctx.fromDate} to ${ctx.toDate}` }, reportFont, drawPdfReportHeaderServer);

  return Buffer.from(doc.output("arraybuffer"));
}
