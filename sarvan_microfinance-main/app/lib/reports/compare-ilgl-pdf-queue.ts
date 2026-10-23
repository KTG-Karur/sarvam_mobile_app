import { jsPDF } from "jspdf";
import { getReportEntry } from "@/app/lib/reports/report-registry";
import { drawCompareIlglReport } from "@/app/lib/reports/compare-ilgl-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";
import { toDisplayDate } from '@/app/lib/date-format';

/**
 * Request Report / Request Queue PDF renderer for "compare-ilgl" — reuses
 * the exact same drawCompareIlglReport() the Direct Download PDF uses
 * (app/lib/reports/compare-ilgl-pdf.ts), just with Node-safe logo/font
 * loading injected instead of the browser-only defaults.
 *
 * Reuses the report registry's own fetchCompareIlgl() (via getReportEntry)
 * for row data — the exact same adapter already used for this report's
 * Excel/CSV/Word queue exports (which itself requires exactly one resolved
 * branch, since this comparison is single-branch by construction) — so no
 * query or figure is recalculated for PDF.
 */
export async function buildCompareIlglQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate) {
    throw new Error("A comparison date is required for the Compare IL GL Values report");
  }

  const entry = getReportEntry("compare-ilgl");
  if (!entry?.fetch) {
    throw new Error("Compare IL GL Values report is not registered");
  }
  const { rows } = await entry.fetch({
    fromDate: ctx.fromDate,
    toDate: ctx.toDate,
    branchIds: ctx.branchIds,
    filters: ctx.filters,
  });

  const comparisonData = rows.map((r) => ({
    ledger: String(r[0]),
    tb: Number(r[1]),
    il: Number(r[2]),
    difference: Number(r[3]),
  }));

  const dateStr = toDisplayDate(new Date(ctx.fromDate));

  const doc = new jsPDF({ orientation: "landscape" });
  const reportFont = ensureReportFontServer(doc);

  await drawCompareIlglReport(
    doc,
    comparisonData,
    { subtitle: `As On: ${dateStr}` },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
