import { jsPDF } from "jspdf";
import { computeCompanyProfile } from "@/app/api/reports/mis/company-profile/route";
import { drawCompanyProfileReport } from "@/app/lib/reports/company-profile-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

/**
 * Request Report / Request Queue PDF renderer for "company-profile" — reuses
 * the exact same drawCompanyProfileReport() the Direct Download PDF uses
 * (app/lib/reports/company-profile-pdf.ts), just with Node-safe logo/font
 * loading injected instead of the browser-only defaults.
 *
 * Reuses computeCompanyProfile() — newly split out of
 * GET /api/reports/mis/company-profile's inline handler as part of this
 * migration (that route previously had no exported/shared compute function).
 * This is a system-wide, ADMIN-only report with no branch scoping, so unlike
 * loan-index/loan-ledger there's no user/branch-access check to preserve.
 * report-registry.ts's fetchCompanyProfile (a separate, flattened 2-column
 * shape used for Excel/CSV/Word) is untouched by this migration.
 */
export async function buildCompanyProfileQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  const data = await computeCompanyProfile(ctx.fromDate ?? null);

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const reportFont = ensureReportFontServer(doc);

  await drawCompanyProfileReport(doc, data, reportFont, drawPdfReportHeaderServer);

  return Buffer.from(doc.output("arraybuffer"));
}
