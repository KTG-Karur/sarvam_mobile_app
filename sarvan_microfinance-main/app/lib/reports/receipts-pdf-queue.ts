import { jsPDF } from "jspdf";
import { getReportEntry } from "@/app/lib/reports/report-registry";
import { drawReceiptsReport } from "@/app/lib/reports/receipts-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";
import { toDisplayDate } from '@/app/lib/date-format';

/**
 * Request Report / Request Queue PDF renderer for "receipts" — reuses the
 * exact same drawReceiptsReport() the Direct Download PDF uses
 * (app/lib/reports/receipts-pdf.ts), just with Node-safe logo/font loading
 * injected instead of the browser-only defaults.
 *
 * Reuses the report registry's own fetchReceipts() (via getReportEntry) —
 * it returns the exact same 16 columns/order and the same GRAND TOTAL row
 * content as Direct's own buildReceiptsExportRows() (both derive from the
 * same LoanTransaction fields), so `rows` is passed straight through with
 * no server-side recomputation.
 */
export async function buildReceiptsQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate || !ctx.toDate) {
    throw new Error("fromDate and toDate are required for the Receipts report");
  }

  const entry = getReportEntry("receipts");
  if (!entry?.fetch) {
    throw new Error("Receipts report is not registered");
  }
  const { headers, rows } = await entry.fetch({
    fromDate: ctx.fromDate,
    toDate: ctx.toDate,
    branchIds: ctx.branchIds,
    filters: ctx.filters,
  });

  const doc = new jsPDF({ orientation: "landscape" });
  const reportFont = ensureReportFontServer(doc);

  await drawReceiptsReport(
    doc,
    headers,
    rows,
    { subtitle: `${toDisplayDate(new Date(ctx.fromDate))} to ${toDisplayDate(new Date(ctx.toDate))}` },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
