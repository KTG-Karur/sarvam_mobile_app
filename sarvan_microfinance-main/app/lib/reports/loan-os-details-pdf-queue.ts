import { jsPDF } from "jspdf";
import { getReportEntry } from "@/app/lib/reports/report-registry";
import { drawLoanOsDetailsReport } from "@/app/lib/reports/loan-os-details-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";
import { toDisplayDate } from '@/app/lib/date-format';

/**
 * Request Report / Request Queue PDF renderer for "loan-os-details" —
 * reuses the exact same drawLoanOsDetailsReport() the Direct Download PDF
 * uses (app/lib/reports/loan-os-details-pdf.ts), just with Node-safe
 * logo/font loading injected instead of the browser-only defaults.
 *
 * Reuses the report registry's own fetchLoanOsDetails() (via
 * getReportEntry) — the exact same 26 columns/order as Direct's own
 * buildLoanOSExportRows(). fetchLoanOsDetails's ReportRows has no trailing
 * Grand Total row, so it's recomputed here by summing the already-fetched
 * rows' 8 numeric columns (indices 9,10,11,12,13,14,18,19) — never via a
 * new query — mirroring the same workaround already used by this report's
 * Word queue export.
 */
export async function buildLoanOsDetailsQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate) {
    throw new Error("A report date is required for the Loan OS Details report");
  }

  const entry = getReportEntry("loan-os-details");
  if (!entry?.fetch) {
    throw new Error("Loan OS Details report is not registered");
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
    body.push([
      "Grand Total:", "", "", "", "", "", "", "", "",
      sum(9), sum(10), sum(11), sum(12), sum(13), sum(14),
      "", "", "", sum(18), sum(19), "", "", "", "", "", "",
    ]);
  }

  const doc = new jsPDF({ orientation: "landscape" });
  const reportFont = ensureReportFontServer(doc);

  await drawLoanOsDetailsReport(
    doc,
    headers,
    body,
    { subtitle: `Report Date: ${toDisplayDate(new Date(ctx.fromDate))}` },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
