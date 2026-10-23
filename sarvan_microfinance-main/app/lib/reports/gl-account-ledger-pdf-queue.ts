import { jsPDF } from "jspdf";
import { computeGlOneAccount } from "@/app/api/reports/gl-one/route";
import { drawGlAccountLedgerReport } from "@/app/lib/reports/gl-account-ledger-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";
import { toDisplayDate } from '@/app/lib/date-format';

/**
 * Request Report / Request Queue PDF renderer for "gl-account-ledger" (GL One) —
 * reuses the exact same drawGlAccountLedgerReport() the Direct Download PDF uses
 * (app/lib/reports/gl-account-ledger-pdf.ts), just with Node-safe logo/font
 * loading (drawPdfReportHeaderServer / ensureReportFontServer) injected instead
 * of the browser-only defaults — so the queued PDF is structurally and visually
 * the same report, not the generic flat-table Puppeteer layout.
 *
 * Reuses computeGlOneAccount() from app/api/reports/gl-one/route.ts — the exact
 * same function the live page's GET /api/reports/gl-one route calls, and the
 * exact same function report-registry.ts's fetchGlOne() already calls for
 * Excel/CSV/Word — no new query, no recalculated figures.
 */

function formatDateLabel(dateStr: string): string {
  return toDisplayDate(new Date(dateStr));
}

export async function buildGlAccountLedgerQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate || !ctx.toDate) {
    throw new Error("fromDate and toDate are required for the GL Account Ledger report");
  }
  const accountId = ctx.filters?.accountId;
  if (!accountId) {
    throw new Error("filters.accountId is required for the GL Account Ledger report");
  }

  const startDate = new Date(ctx.fromDate);
  const endDate = new Date(`${ctx.toDate}T23:59:59.999`);
  const result = await computeGlOneAccount(accountId, startDate, endDate, ctx.branchIds);
  if (!result) {
    throw new Error("Account not found");
  }

  const doc = new jsPDF({ orientation: "landscape" });
  const reportFont = ensureReportFontServer(doc);

  await drawGlAccountLedgerReport(
    doc,
    result,
    { periodLabel: `${formatDateLabel(ctx.fromDate)} to ${formatDateLabel(ctx.toDate)}` },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
