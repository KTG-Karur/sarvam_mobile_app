import { jsPDF } from "jspdf";
import { computeGlAllAccounts } from "@/app/api/reports/gl-all/route";
import { drawGlAllReport } from "@/app/lib/reports/gl-all-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";
import { toDisplayDate } from '@/app/lib/date-format';

/**
 * Request Report / Request Queue PDF renderer for "gl-all" — reuses the exact
 * same drawGlAllReport() the Direct Download PDF uses (app/lib/reports/gl-all-pdf.ts),
 * just with Node-safe logo/font loading (drawPdfReportHeaderServer /
 * ensureReportFontServer) injected instead of the browser-only defaults — so the
 * queued PDF is structurally and visually the same report, not the generic
 * flat-table Puppeteer layout.
 *
 * Reuses computeGlAllAccounts() from app/api/reports/gl-all/route.ts — the exact
 * same function the live page's GET /api/reports/gl-all route calls, and the
 * exact same function report-registry.ts's fetchGlAll() already calls for
 * Excel/CSV/Word — no new query, no recalculated figures.
 */

function formatDateLabel(dateStr: string): string {
  return toDisplayDate(new Date(dateStr));
}

export async function buildGlAllQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate || !ctx.toDate) {
    throw new Error("fromDate and toDate are required for the General Ledger - All Accounts report");
  }

  const startDate = new Date(ctx.fromDate);
  const endDate = new Date(`${ctx.toDate}T23:59:59.999`);
  const accounts = await computeGlAllAccounts(ctx.branchIds, startDate, endDate);

  const doc = new jsPDF({ orientation: "landscape" });
  const reportFont = ensureReportFontServer(doc);

  // The Direct page's ExportDropdown only ever sets reportSlug (enabling the
  // queue) when reportType === 'consolidated' — 'head_office' always stays on
  // Direct Download (see GLAllPage.tsx's ExportDropdown reportSlug condition).
  // This queue path is therefore only ever reached for the consolidated view,
  // so the label is fixed accordingly rather than re-derived from filters.
  await drawGlAllReport(
    doc,
    accounts,
    {
      reportTypeLabel: "CONSOLIDATED",
      periodLabel: `Period: ${formatDateLabel(ctx.fromDate)} to ${formatDateLabel(ctx.toDate)}`,
    },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
