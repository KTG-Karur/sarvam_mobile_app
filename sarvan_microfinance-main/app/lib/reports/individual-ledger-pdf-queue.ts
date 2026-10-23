import { jsPDF } from "jspdf";
import { getReportEntry } from "@/app/lib/reports/report-registry";
import { drawIndividualLedgerReport } from "@/app/lib/reports/individual-ledger-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";
import { toDisplayDate } from '@/app/lib/date-format';

/**
 * Request Report / Request Queue PDF renderer for "individual-ledger" —
 * reuses the exact same drawIndividualLedgerReport() the Direct Download
 * PDF uses (app/lib/reports/individual-ledger-pdf.ts), just with
 * Node-safe logo/font loading injected instead of the browser-only
 * defaults.
 *
 * Reuses the report registry's own fetchIndividualLedger() (via
 * getReportEntry) — the exact same getIndividualLedgerData() the live
 * route calls — for row data. fetchIndividualLedger's ReportRows has no
 * trailing TOTAL row (unlike Direct's own
 * buildIndividualLedgerExportRows()), so it's recomputed here by summing
 * the already-fetched rows' OS_OWNFUND/CL_OWNFUND columns — never via a
 * new query — mirroring the same workaround already used by this report's
 * Word queue export.
 */
export async function buildIndividualLedgerQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate || !ctx.toDate) {
    throw new Error("fromDate and toDate are required for the Individual Ledger report");
  }

  const entry = getReportEntry("individual-ledger");
  if (!entry?.fetch) {
    throw new Error("Individual Ledger report is not registered");
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
    body.push(["TOTAL", "", "", sum(3), sum(4)]);
  }

  const doc = new jsPDF({ orientation: "landscape" });
  const reportFont = ensureReportFontServer(doc);

  await drawIndividualLedgerReport(
    doc,
    headers,
    body,
    { subtitle: `${toDisplayDate(new Date(ctx.fromDate))} - ${toDisplayDate(new Date(ctx.toDate))}` },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
