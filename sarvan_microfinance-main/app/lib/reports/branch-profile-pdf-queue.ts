import { jsPDF } from "jspdf";
import { computeBranchProfile } from "@/app/api/reports/others/branch-profile/route";
import { drawBranchProfileReport } from "@/app/lib/reports/branch-profile-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

/**
 * Request Report / Request Queue PDF renderer for "branch-profile" — reuses
 * the exact same drawBranchProfileReport() the Direct Download PDF uses
 * (app/lib/reports/branch-profile-pdf.ts), just with Node-safe logo/font
 * loading injected instead of the browser-only defaults.
 *
 * Reuses computeBranchProfile() from
 * app/api/reports/others/branch-profile/route.ts — the exact same function
 * already shared with the live GET route — so no query or figure is
 * recalculated for PDF. The single required branchId is derived exactly as
 * report-registry.ts's fetchBranchProfile() already does (filters.branchId,
 * falling back to a single-element branchIds array).
 */
export async function buildBranchProfileQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  const branchId = ctx.filters?.branchId ?? (ctx.branchIds && ctx.branchIds.length === 1 ? ctx.branchIds[0] : undefined);
  if (!branchId) {
    throw new Error("A single branch is required for the Branch Profile report");
  }
  if (ctx.branchIds && !ctx.branchIds.includes(branchId)) {
    throw new Error("You do not have access to this branch");
  }

  const data = await computeBranchProfile(branchId, ctx.fromDate ?? null);

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const reportFont = ensureReportFontServer(doc);

  await drawBranchProfileReport(doc, data, reportFont, drawPdfReportHeaderServer);

  return Buffer.from(doc.output("arraybuffer"));
}
