import { jsPDF } from "jspdf";
import { queryLoans as queryPortfolioLoans, buildRows as buildPortfolioRows } from "@/app/api/admin-reports/portfolio/client-portfolio-report/route";
import { drawClientPortfolioReport } from "@/app/lib/reports/client-portfolio-report-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

/**
 * Request Report / Request Queue PDF renderer for "client-portfolio-report"
 * — reuses the exact same drawClientPortfolioReport() the Direct Download
 * PDF uses (app/lib/reports/client-portfolio-report-pdf.ts), just with
 * Node-safe logo/font loading injected instead of the browser-only
 * defaults.
 *
 * Reuses queryLoans/buildRows from
 * app/api/admin-reports/portfolio/client-portfolio-report/route.ts — the
 * exact same exported functions both the live GET route and
 * report-registry.ts's fetchClientPortfolioReport already call — so no
 * query or figure is recalculated for PDF. The where-clause construction
 * below mirrors fetchClientPortfolioReport's own (report-registry.ts),
 * which itself is documented as mirroring the live route's where-clause —
 * the same "shared query/compute, format-specific shaping" pattern already
 * used throughout this codebase. This report has no date filter
 * (dateMode: 'NONE'), matching Direct's own PDF export.
 */
export async function buildClientPortfolioReportQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  const filters = ctx.filters;

  const branchWhere: any = {};
  if (ctx.branchIds) branchWhere.id = ctx.branchIds.length === 1 ? ctx.branchIds[0] : { in: ctx.branchIds };
  if (filters?.areaId) branchWhere.areas = { some: { id: filters.areaId } };
  else if (filters?.divisionId) branchWhere.areas = { some: { division: { id: filters.divisionId } } };
  else if (filters?.regionId) branchWhere.areas = { some: { division: { region: { id: filters.regionId } } } };

  const loanProductWhere: any = {};
  if (filters?.productTypeId) loanProductWhere.loanProductTypeId = filters.productTypeId;
  if (filters?.loanProductId) loanProductWhere.productId = filters.loanProductId;

  const where: any = {
    disbursementStatus: "DISBURSED",
    ...(filters?.centerId && { centerId: filters.centerId }),
    ...(filters?.funderId && { funderId: filters.funderId }),
    ...(Object.keys(loanProductWhere).length > 0 && { loanProduct: loanProductWhere }),
    ...(Object.keys(branchWhere).length > 0 && { center: { branch: branchWhere } }),
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const loans = await queryPortfolioLoans(where, undefined, 5000);
  const allData = buildPortfolioRows(loans, 0, today);

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });
  const reportFont = ensureReportFontServer(doc);

  await drawClientPortfolioReport(
    doc,
    allData,
    { subtitle: `Total Loans: ${allData.length}` },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
