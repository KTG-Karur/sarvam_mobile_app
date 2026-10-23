import { jsPDF } from "jspdf";
import { computeReceiptsPaymentsCore } from "@/app/api/reports/receipts-payments/route";
import { buildFinancialTransactionBranchScope } from "@/app/lib/filters/financial-transaction-branch";
import { drawReceiptsPaymentsReport } from "@/app/lib/reports/receipts-payments-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";
import { toDisplayDate } from '@/app/lib/date-format';

/**
 * Request Report / Request Queue PDF renderer for "receipts-payments" — reuses
 * the exact same drawReceiptsPaymentsReport() the Direct Download PDF uses
 * (app/lib/reports/receipts-payments-pdf.ts), just with Node-safe logo/font
 * loading injected instead of the browser-only defaults.
 *
 * Reuses computeReceiptsPaymentsCore() from
 * app/api/reports/receipts-payments/route.ts — the exact same "cookie-free
 * core" function already shared with the live GET route and with
 * report-registry.ts's fetchReceiptsPayments() — so no query or figure is
 * recalculated for PDF. Queue mode is RANGE-only, matching fetchReceiptsPayments
 * and the Direct page's own ExportDropdown gating (AS_ON is excluded from
 * REQUEST_QUEUE there).
 */

function formatDateLabel(dateStr: string): string {
  return toDisplayDate(new Date(dateStr));
}

export async function buildReceiptsPaymentsQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate || !ctx.toDate) {
    throw new Error("fromDate and toDate are required for the Receipts & Payments report");
  }
  const startDate = new Date(ctx.fromDate);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(`${ctx.toDate}T23:59:59.999`);
  const branchFilter = buildFinancialTransactionBranchScope({ branchId: ctx.branchIds ?? undefined });
  const data = await computeReceiptsPaymentsCore(branchFilter, ctx.branchIds, "RANGE", startDate, endDate);

  const periodLabel = `FOR DATE BETWEEN ${formatDateLabel(ctx.fromDate)} AND ${formatDateLabel(ctx.toDate)}`;

  const doc = new jsPDF({ orientation: "landscape" });
  const reportFont = ensureReportFontServer(doc);

  await drawReceiptsPaymentsReport(
    doc,
    data,
    { subtitle: `CONSOLIDATED  •  ${periodLabel.toUpperCase()}` },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
