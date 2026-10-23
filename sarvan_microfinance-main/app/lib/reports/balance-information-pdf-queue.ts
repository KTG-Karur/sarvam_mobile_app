import { jsPDF } from "jspdf";
import { getReportEntry } from "@/app/lib/reports/report-registry";
import { drawBalanceInformationReport } from "@/app/lib/reports/balance-information-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

/**
 * Request Report / Request Queue PDF renderer for "balance-information" —
 * reuses the exact same drawBalanceInformationReport() the Direct Download
 * PDF uses (app/lib/reports/balance-information-pdf.ts), just with
 * Node-safe logo/font loading injected instead of the browser-only
 * defaults.
 *
 * Reuses the report registry's own fetchBalanceInformation() (via
 * getReportEntry) for row data — the exact same adapter already used for
 * this report's Excel/CSV/Word queue exports (including its branch-access
 * check), whose 12-column row shape already matches the Direct PDF's row
 * shape exactly. Direct's PDF appends a trailing "Grand Total" row that
 * fetchBalanceInformation itself doesn't include; it's added here the same
 * way Direct builds it — summing the already-fetched columns, not a new
 * query.
 */
export async function buildBalanceInformationQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate) {
    throw new Error("An As-On date is required for the Balance Information report");
  }

  const entry = getReportEntry("balance-information");
  if (!entry?.fetch) {
    throw new Error("Balance Information report is not registered");
  }
  const { headers, rows } = await entry.fetch({
    fromDate: ctx.fromDate,
    toDate: ctx.toDate,
    branchIds: ctx.branchIds,
    filters: ctx.filters,
  });

  if (rows.length > 0) {
    const sum = (colIndex: number) => rows.reduce((s, r) => s + Number(r[colIndex] ?? 0), 0);
    rows.push(["", "Grand Total:", "", "", "", "", "", sum(7), sum(8), sum(9), sum(10), ""]);
  }

  const doc = new jsPDF({ orientation: "landscape" });
  const reportFont = ensureReportFontServer(doc);

  await drawBalanceInformationReport(
    doc,
    { headers, rows },
    { subtitle: `As on ${ctx.fromDate}` },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
