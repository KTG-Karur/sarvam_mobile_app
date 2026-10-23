import { jsPDF } from "jspdf";
import { getReportEntry } from "@/app/lib/reports/report-registry";
import { drawCcrReport } from "@/app/lib/reports/ccr-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

/**
 * Request Report / Request Queue PDF renderer for "ccr" — reuses the exact
 * same drawCcrReport() the Direct Download PDF uses
 * (app/lib/reports/ccr-pdf.ts), just with Node-safe logo/font loading
 * injected instead of the browser-only defaults.
 *
 * Reuses the report registry's own fetchCcr() (via getReportEntry) for row
 * data — the exact same adapter already used for this report's Excel/CSV/Word
 * queue exports, itself backed by getCCRData() (shared with the live CCR
 * page) — its 19-column shape already matches the Direct PDF's row shape
 * exactly, so no query or figure is recalculated for PDF.
 */
export async function buildCcrQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate || !ctx.toDate) {
    throw new Error("fromDate and toDate are required for the Client Collection Report");
  }

  const entry = getReportEntry("ccr");
  if (!entry?.fetch) {
    throw new Error("Client Collection Report is not registered");
  }
  const { headers, rows } = await entry.fetch({
    fromDate: ctx.fromDate,
    toDate: ctx.toDate,
    branchIds: ctx.branchIds,
    filters: ctx.filters,
  });

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });
  const reportFont = ensureReportFontServer(doc);

  await drawCcrReport(
    doc,
    { headers, rows },
    { subtitle: `From ${ctx.fromDate} to ${ctx.toDate}` },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
