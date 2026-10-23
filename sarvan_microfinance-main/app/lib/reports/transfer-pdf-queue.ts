import { jsPDF } from "jspdf";
import { getReportEntry } from "@/app/lib/reports/report-registry";
import { drawTransferReport, type TransferRow } from "@/app/lib/reports/transfer-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

/**
 * Request Report / Request Queue PDF renderer for "transfer" — reuses the
 * exact same drawTransferReport() the Direct Download PDF uses
 * (app/lib/reports/transfer-pdf.ts), just with Node-safe logo/font loading
 * injected instead of the browser-only defaults.
 *
 * Reuses the report registry's own fetchTransfer() (via getReportEntry),
 * which already mirrors the same per-branch fan-out
 * app/api/reports/client/transfer/route.ts uses and returns the exact same
 * 9 columns/order as the client's own buildTransferExportRows() — so no
 * query or figure is recalculated for PDF.
 */
export async function buildTransferQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate || !ctx.toDate) {
    throw new Error("fromDate and toDate are required for the Client Transfer report");
  }

  const entry = getReportEntry("transfer");
  if (!entry?.fetch) {
    throw new Error("Client Transfer report is not registered");
  }
  const { rows: rawRows } = await entry.fetch({
    fromDate: ctx.fromDate,
    toDate: ctx.toDate,
    branchIds: ctx.branchIds,
    filters: ctx.filters,
  });

  const rows: TransferRow[] = rawRows.map((r) => ({
    clientName: String(r[0]), oldClientId: String(r[1]), newClientId: String(r[2]),
    oldCenterName: String(r[3]), newCenterName: String(r[4]),
    fromDate: String(r[5]), tillDate: String(r[6]), performedBy: String(r[7]), remarks: String(r[8]),
  }));

  const doc = new jsPDF({ orientation: "landscape" });
  const reportFont = ensureReportFontServer(doc);

  await drawTransferReport(doc, rows, { subtitle: `${ctx.fromDate} to ${ctx.toDate}` }, reportFont, drawPdfReportHeaderServer);

  return Buffer.from(doc.output("arraybuffer"));
}
