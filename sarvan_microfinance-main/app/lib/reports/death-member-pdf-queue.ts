import { jsPDF } from "jspdf";
import { format, isValid } from "date-fns";
import { queryDeathMemberRows } from "@/app/api/reports/client/death-member/route";
import { drawDeathMemberReport } from "@/app/lib/reports/death-member-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

/**
 * Request Report / Request Queue PDF renderer for "death-member" — reuses
 * the exact same drawDeathMemberReport() the Direct Download PDF uses
 * (app/lib/reports/death-member-pdf.ts), just with Node-safe logo/font
 * loading injected instead of the browser-only defaults.
 *
 * Reuses queryDeathMemberRows() from
 * app/api/reports/client/death-member/route.ts — the exact same function
 * both the live GET route and report-registry.ts's fetchDeathMember already
 * call — so no query or figure is recalculated for PDF.
 */
function formatDateLabel(dateStr: string): string {
  const dt = new Date(dateStr);
  return isValid(dt) ? format(dt, "dd/MM/yyyy") : "—";
}

export async function buildDeathMemberQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate || !ctx.toDate) {
    throw new Error("fromDate and toDate are required for the Death Member Report");
  }

  const data = await queryDeathMemberRows({
    fromDate: ctx.fromDate,
    toDate: ctx.toDate,
    branchIds: ctx.branchIds,
    centerId: ctx.filters?.centerId ?? null,
    areaId: ctx.filters?.areaId ?? null,
    divisionId: ctx.filters?.divisionId ?? null,
    regionId: ctx.filters?.regionId ?? null,
  });

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });
  const reportFont = ensureReportFontServer(doc);

  await drawDeathMemberReport(
    doc,
    data,
    { subtitle: `Period: ${formatDateLabel(ctx.fromDate)} to ${formatDateLabel(ctx.toDate)}` },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
