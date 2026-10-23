import { jsPDF } from "jspdf";
import { getDCRData } from "@/app/lib/actions/reports";
import { drawDcrReport } from "@/app/lib/reports/dcr-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";
import { getLoanAdvanceEnabled } from "@/app/lib/loan-advance-config";
import { toDisplayDate } from '@/app/lib/date-format';

/**
 * Request Report / Request Queue PDF renderer for "dcr" — reuses the exact
 * same drawDcrReport() the Direct Download PDF uses
 * (app/lib/reports/dcr-pdf.ts), just with Node-safe logo/font loading
 * injected instead of the browser-only defaults.
 *
 * Reuses getDCRData() from app/lib/actions/reports.ts — the exact same
 * Server Action both DCRClient.tsx's "Show" button and report-registry.ts's
 * fetchDcr already call (via preResolvedBranchIds, skipping the
 * cookie-based auth this queue context doesn't have) — so no query or
 * figure is recalculated for PDF.
 */
export async function buildDcrQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate) {
    throw new Error("A report date is required for the Daily Collection Report");
  }
  const centerId = ctx.filters?.centerId ?? "all";

  const result = await getDCRData(ctx.fromDate, undefined, centerId, ctx.branchIds);

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });
  const reportFont = ensureReportFontServer(doc);

  await drawDcrReport(
    doc,
    result.rows,
    result.funders,
    { subtitle: `Date: ${toDisplayDate(new Date(ctx.fromDate))}` },
    reportFont,
    drawPdfReportHeaderServer,
    await getLoanAdvanceEnabled()
  );

  return Buffer.from(doc.output("arraybuffer"));
}
