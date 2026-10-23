import { jsPDF } from "jspdf";
import { getReportEntry } from "@/app/lib/reports/report-registry";
import { drawFunderInterestReport, FY_MONTHS, type FunderInterestRow, type FYMonth } from "@/app/lib/reports/funder-interest-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

/**
 * Request Report / Request Queue PDF renderer for "funder-interest" —
 * reuses the exact same drawFunderInterestReport() the Direct Download PDF
 * uses (app/lib/reports/funder-interest-pdf.ts), just with Node-safe
 * logo/font loading injected instead of the browser-only defaults.
 *
 * Reuses the report registry's own fetchFunderInterest() (via
 * getReportEntry) for the per-funder monthly rows — the exact same query
 * this report's Excel/CSV/Word queue exports already use — so no query is
 * duplicated for PDF. fetchFunderInterest's ReportRows has no trailing
 * totals row (unlike the live API route's separately-computed
 * grandTotals/grandTotal), so the TOTAL row is recomputed here by summing
 * the already-fetched per-funder rows — never via a new query — mirroring
 * the same workaround already used by
 * app/lib/reports/word/options/funder-interest.ts's Word export.
 */
export async function buildFunderInterestQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  const year = parseInt(ctx.filters?.year || "", 10);
  if (!year || year < 2000 || year > 2100) {
    throw new Error("A valid financial year (filters.year) is required for the Funder Interest report");
  }

  const entry = getReportEntry("funder-interest");
  if (!entry?.fetch) {
    throw new Error("Funder Interest report is not registered");
  }
  const { rows: rawRows } = await entry.fetch({
    fromDate: null,
    toDate: null,
    branchIds: ctx.branchIds,
    filters: ctx.filters,
  });

  const rows: FunderInterestRow[] = rawRows.map((r) => {
    const [funderName, ...rest] = r;
    const months = FY_MONTHS.reduce((acc, m, i) => {
      acc[m] = Number(rest[i]) || 0;
      return acc;
    }, {} as Record<FYMonth, number>);
    return {
      funderName: String(funderName),
      ...months,
      totalPayment: Number(rest[FY_MONTHS.length]) || 0,
    };
  });

  const grandTotals = FY_MONTHS.reduce((acc, m) => {
    acc[m] = rows.reduce((s, r) => s + r[m], 0);
    return acc;
  }, {} as Record<FYMonth, number>);
  const grandTotal = rows.reduce((s, r) => s + r.totalPayment, 0);

  const fyLabel = `FY ${year}-${String(year + 1).slice(-2)}`;

  const doc = new jsPDF({ orientation: "landscape" });
  const reportFont = ensureReportFontServer(doc);

  await drawFunderInterestReport(doc, rows, grandTotals, grandTotal, { fyLabel }, reportFont, drawPdfReportHeaderServer);

  return Buffer.from(doc.output("arraybuffer"));
}
