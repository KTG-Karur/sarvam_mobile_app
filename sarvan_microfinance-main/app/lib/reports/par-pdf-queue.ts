import { jsPDF } from "jspdf";
import { getPortfolioAtRiskData } from "@/app/lib/actions/reports";
import { drawParReport } from "@/app/lib/reports/par-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

/**
 * Request Report / Request Queue PDF renderer for "par" — reuses the exact
 * same drawParReport() the Direct Download PDF uses
 * (app/lib/reports/par-pdf.ts), just with Node-safe logo/font loading
 * injected instead of the browser-only defaults.
 *
 * Reuses getPortfolioAtRiskData() from app/lib/actions/reports.ts — the exact
 * same function both the live GET /api/reports/portfolio/par route and
 * report-registry.ts's fetchPar already call — so no query or figure is
 * recalculated for PDF. The PAR% column is derived by drawParReport itself,
 * from outstandingPrincipal/closingOdPrincipal already in the raw row data —
 * matching what the Direct page's own computePar() does, not a new figure.
 * As of Batch 4B, fetchPar computes this same ratio independently for its own
 * 49-column Excel/CSV/Word output, but this PDF path still derives its own
 * copy rather than reusing fetchPar, to stay independent of report-registry.ts.
 */
export async function buildParQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  const centerId = ctx.filters?.centerId || "all";
  const result = await getPortfolioAtRiskData(centerId, ctx.branchIds ?? undefined);

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });
  const reportFont = ensureReportFontServer(doc);

  await drawParReport(doc, result.data, reportFont, drawPdfReportHeaderServer);

  return Buffer.from(doc.output("arraybuffer"));
}
