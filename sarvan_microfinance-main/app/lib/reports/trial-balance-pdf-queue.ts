import { jsPDF } from "jspdf";
import { getReportEntry } from "@/app/lib/reports/report-registry";
import { drawTrialBalanceReport } from "@/app/lib/reports/trial-balance-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

const formatDateForDisplay = (dateString: string | null | undefined) => {
  if (!dateString) return "";
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateString);
  if (match) {
    const [, year, month, day] = match;
    return `${day}/${month}/${year}`;
  }
  return dateString;
};

/**
 * Request Report / Request Queue PDF renderer for "trial-balance" —
 * reuses the exact same drawTrialBalanceReport() the Direct Download PDF
 * uses (app/lib/reports/trial-balance-pdf.ts), just with Node-safe
 * logo/font loading injected instead of the browser-only defaults.
 *
 * Reuses the report registry's own fetchTrialBalance() (via
 * getReportEntry) — it explicitly mirrors
 * components/accounts/TrialBalanceClient.tsx's buildDisplayRows()/
 * buildTrialBalanceExportRows() (same indent convention, rounding, and
 * GRAND TOTAL construction, both reading the same computeTrialBalanceRows()
 * used by the live route), so `rows` is passed straight through with no
 * recomputation.
 */
export async function buildTrialBalanceQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate) {
    throw new Error("A date is required for the Trial Balance report");
  }

  const entry = getReportEntry("trial-balance");
  if (!entry?.fetch) {
    throw new Error("Trial Balance report is not registered");
  }
  const { headers, rows } = await entry.fetch({
    fromDate: ctx.fromDate,
    toDate: ctx.toDate,
    branchIds: ctx.branchIds,
    filters: ctx.filters,
  });

  const reportType = (ctx.filters?.reportType as "RANGE" | "AS_ON") || "AS_ON";
  const periodLabel = reportType === "RANGE"
    ? `PERIOD: ${formatDateForDisplay(ctx.fromDate)} to ${formatDateForDisplay(ctx.toDate)}`
    : `AS ON DATE ${formatDateForDisplay(ctx.fromDate)}`;

  const doc = new jsPDF({ orientation: "landscape" });
  const reportFont = ensureReportFontServer(doc);

  await drawTrialBalanceReport(doc, headers, rows, { subtitle: `${ctx.branchLabel}  •  ${periodLabel}` }, reportFont, drawPdfReportHeaderServer);

  return Buffer.from(doc.output("arraybuffer"));
}
