import { jsPDF } from "jspdf";
import { prisma } from "@/app/lib/db";
import { getReportEntry } from "@/app/lib/reports/report-registry";
import { drawMisLedgerReport } from "@/app/lib/reports/mis-ledger-report-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

/**
 * Request Report / Request Queue PDF renderer for "mis-ledger-report" — reuses the
 * exact same drawMisLedgerReport() the Direct Download PDF uses
 * (app/lib/reports/mis-ledger-report-pdf.ts), just with Node-safe logo/font loading
 * injected instead of the browser-only defaults.
 *
 * Reuses the report registry's own fetchMisLedgerReport() (via getReportEntry) for
 * row data — the exact same adapter already used for this report's Excel/CSV/Word
 * queue exports, itself backed by computeLedgerReport() (shared with the live
 * GET /api/reports/ledger-report route) — so no query or figure is recalculated
 * for PDF. The ledger name (needed only for the subtitle, not part of ReportRows)
 * is looked up separately via a single cheap AccountLedger read.
 */

function formatDateLabel(dateStr: string): string {
  const date = new Date(dateStr);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

export async function buildMisLedgerReportQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  const ledgerId = ctx.filters?.ledgerId;
  if (!ledgerId) {
    throw new Error("filters.ledgerId is required for the MIS Ledger report");
  }
  const reportType = (ctx.filters?.reportType as "RANGE" | "AS_ON") || "RANGE";

  const entry = getReportEntry("mis-ledger-report");
  if (!entry?.fetch) {
    throw new Error("MIS Ledger Report is not registered");
  }
  const { headers, rows } = await entry.fetch({
    fromDate: ctx.fromDate,
    toDate: ctx.toDate,
    branchIds: ctx.branchIds,
    filters: ctx.filters,
  });

  const ledger = await prisma.accountLedger.findUnique({
    where: { id: ledgerId },
    select: { ledgerName: true },
  });

  const periodLabel =
    reportType === "RANGE" && ctx.fromDate && ctx.toDate
      ? `Period: ${formatDateLabel(ctx.fromDate)} to ${formatDateLabel(ctx.toDate)}`
      : `As On: ${formatDateLabel(ctx.fromDate as string)}`;

  const doc = new jsPDF({ orientation: "landscape" });
  const reportFont = ensureReportFontServer(doc);

  await drawMisLedgerReport(
    doc,
    { headers, rows },
    { subtitle: `Ledger: ${ledger?.ledgerName || ledgerId}  •  ${periodLabel}` },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
