import { jsPDF } from "jspdf";
import { getDenominationCollectionReport } from "@/app/lib/reports/denomination-collection";
import { drawDenominationCollectionReport } from "@/app/lib/reports/denomination-collection-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

/**
 * Request Report / Request Queue PDF renderer for "denomination-collection" —
 * reuses the exact same drawDenominationCollectionReport() the Direct
 * Download PDF uses (app/lib/reports/denomination-collection-pdf.ts), just
 * with Node-safe logo/font loading injected instead of the browser-only
 * defaults.
 *
 * Reuses getDenominationCollectionReport() from
 * app/lib/reports/denomination-collection.ts — the exact same function
 * report-registry.ts's fetchDenominationCollection() already calls for
 * Excel/CSV/Word — passing preResolvedBranchIds the same way, so no query or
 * figure is recalculated for PDF. Needs the richer {summary, dailyBreakdown}
 * shape (not fetchDenominationCollection's already-flattened rows), so this
 * calls the underlying function directly rather than going through the
 * registry entry.
 */
export async function buildDenominationCollectionQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate || !ctx.toDate) {
    throw new Error("fromDate and toDate are required for the Denomination Collection report");
  }

  const report = await getDenominationCollectionReport({
    fromDateYmd: ctx.fromDate,
    toDateYmd: ctx.toDate,
    branchIdParam: null,
    user: { userId: "system", role: "SYSTEM" },
    preResolvedBranchIds: ctx.branchIds,
  });

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const reportFont = ensureReportFontServer(doc);

  await drawDenominationCollectionReport(
    doc,
    report,
    { fromDate: ctx.fromDate, toDate: ctx.toDate },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
