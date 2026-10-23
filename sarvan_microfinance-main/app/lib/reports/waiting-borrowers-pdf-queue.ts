import { jsPDF } from "jspdf";
import { getReportEntry } from "@/app/lib/reports/report-registry";
import { drawWaitingBorrowersReport } from "@/app/lib/reports/waiting-borrowers-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

/**
 * Request Report / Request Queue PDF renderer for "waiting-borrowers" —
 * reuses the exact same drawWaitingBorrowersReport() the Direct Download
 * PDF uses (app/lib/reports/waiting-borrowers-pdf.ts), just with
 * Node-safe logo/font loading injected instead of the browser-only
 * defaults.
 *
 * Reuses the report registry's own fetchWaitingBorrowers() (via
 * getReportEntry) — same shared getWaitingBorrowersDetailedRows()/
 * getWaitingBorrowersSummaryRows() the live route calls, branching on
 * filters.reportType exactly like Direct. Neither shape's ReportRows has
 * a trailing Grand Total row, so it's recomputed here by summing the
 * already-fetched rows — never via a new query — mirroring Direct's own
 * buildWaitingBorrowersExportRows().
 */
export async function buildWaitingBorrowersQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  const entry = getReportEntry("waiting-borrowers");
  if (!entry?.fetch) {
    throw new Error("Waiting Borrowers report is not registered");
  }
  const reportType = ctx.filters?.reportType ?? "DETAILED";
  const { headers, rows } = await entry.fetch({
    fromDate: ctx.fromDate,
    toDate: ctx.toDate,
    branchIds: ctx.branchIds,
    filters: ctx.filters,
  });

  const body = rows.slice();
  if (rows.length > 0) {
    const sum = (colIndex: number) => rows.reduce((s, r) => s + Number(r[colIndex] ?? 0), 0);
    if (reportType === "SUMMARY") {
      body.push(["Grand Total:", "", sum(2), sum(3), sum(4), sum(5), sum(6), sum(7), sum(8)]);
    } else {
      body.push(["Grand Total:", "", "", "", "", "", "", "", sum(8), ""]);
    }
  }

  const doc = new jsPDF({ orientation: "landscape" });
  const reportFont = ensureReportFontServer(doc);

  await drawWaitingBorrowersReport(doc, headers, body, { reportType }, reportFont, drawPdfReportHeaderServer);

  return Buffer.from(doc.output("arraybuffer"));
}
