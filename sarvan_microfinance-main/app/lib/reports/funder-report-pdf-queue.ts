import { jsPDF } from "jspdf";
import { getReportEntry } from "@/app/lib/reports/report-registry";
import { drawFunderReportPdf } from "@/app/lib/reports/funder-report-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";
import { toDisplayDate } from '@/app/lib/date-format';

/**
 * Request Report / Request Queue PDF renderer for "funder-report" —
 * reuses the exact same drawFunderReportPdf() the Direct Download PDF
 * uses (app/lib/reports/funder-report-pdf.ts), just with Node-safe
 * logo/font loading injected instead of the browser-only defaults.
 *
 * Reuses the report registry's own fetchFunderReport() (via
 * getReportEntry) — a company-wide, branch-agnostic computation
 * duplicated from (but kept in sync with) app/api/reports/funder-report/route.ts.
 * fetchFunderReport's ReportRows has no trailing TOTAL row, so it's
 * recomputed here by summing the already-fetched rows — never via a new
 * query — mirroring the same workaround already used by this report's
 * Word queue export.
 */
export async function buildFunderReportQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate || !ctx.toDate) {
    throw new Error("fromDate and toDate are required for the Funder Report");
  }

  const entry = getReportEntry("funder-report");
  if (!entry?.fetch) {
    throw new Error("Funder Report is not registered");
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
    body.push(["TOTAL", sum(1), sum(2), sum(3), sum(4)]);
  }

  const doc = new jsPDF({ orientation: "landscape" });
  const reportFont = ensureReportFontServer(doc);

  const fmt = (iso: string) => {
    try {
      return toDisplayDate(new Date(iso));
    } catch {
      return iso;
    }
  };

  await drawFunderReportPdf(doc, headers, body, { subtitle: `Period: ${fmt(ctx.fromDate)} to ${fmt(ctx.toDate)}` }, reportFont, drawPdfReportHeaderServer);

  return Buffer.from(doc.output("arraybuffer"));
}
