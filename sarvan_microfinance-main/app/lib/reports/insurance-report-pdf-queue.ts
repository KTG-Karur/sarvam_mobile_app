import { jsPDF } from "jspdf";
import { getReportEntry } from "@/app/lib/reports/report-registry";
import { drawInsuranceReportPdf } from "@/app/lib/reports/insurance-report-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

/**
 * Request Report / Request Queue PDF renderer for "insurance-report" —
 * reuses the exact same drawInsuranceReportPdf() the Direct Download PDF
 * uses (app/lib/reports/insurance-report-pdf.ts), just with Node-safe
 * logo/font loading injected instead of the browser-only defaults.
 *
 * Reuses the report registry's own fetchInsuranceReport() (via
 * getReportEntry) — it calls queryInsuranceReportRows(), the exact same
 * function the live GET route calls, and its 65-column headers/order are
 * verified identical to Direct's own COLUMNS + Status. No totals row in
 * either (non-additive personal/policy records).
 */
export async function buildInsuranceReportQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  const entry = getReportEntry("insurance-report");
  if (!entry?.fetch) {
    throw new Error("Insurance report is not registered");
  }
  const { headers, rows } = await entry.fetch({
    fromDate: ctx.fromDate,
    toDate: ctx.toDate,
    branchIds: ctx.branchIds,
    filters: ctx.filters,
  });

  const doc = new jsPDF({ orientation: "landscape" });
  const reportFont = ensureReportFontServer(doc);

  await drawInsuranceReportPdf(doc, headers, rows, reportFont, drawPdfReportHeaderServer);

  return Buffer.from(doc.output("arraybuffer"));
}
