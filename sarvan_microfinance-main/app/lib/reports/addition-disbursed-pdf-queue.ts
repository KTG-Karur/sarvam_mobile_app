import { jsPDF } from "jspdf";
import { getClientAdditionDisbursedData } from "@/app/lib/actions/reports";
import { drawAdditionDisbursedReport } from "@/app/lib/reports/addition-disbursed-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

/**
 * Request Report / Request Queue PDF renderer for "addition-disbursed" —
 * reuses the exact same drawAdditionDisbursedReport() the Direct Download
 * PDF uses (app/lib/reports/addition-disbursed-pdf.ts), just with Node-safe
 * logo/font loading injected instead of the browser-only defaults.
 *
 * Reuses getClientAdditionDisbursedData() from app/lib/actions/reports.ts,
 * with the same per-branch fan-out report-registry.ts's
 * fetchAdditionDisbursed already documents mirroring the live GET route's —
 * so no query or figure is recalculated for PDF.
 */
export async function buildAdditionDisbursedQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate || !ctx.toDate) {
    throw new Error("fromDate and toDate are required for the Addition Disbursed report");
  }
  const centerId = ctx.filters?.centerId;
  const branchIds = ctx.branchIds;

  const data = !branchIds
    ? await getClientAdditionDisbursedData(ctx.fromDate, ctx.toDate, centerId, undefined)
    : branchIds.length <= 1
      ? await getClientAdditionDisbursedData(ctx.fromDate, ctx.toDate, centerId, branchIds[0])
      : (await Promise.all(branchIds.map((bId) => getClientAdditionDisbursedData(ctx.fromDate as string, ctx.toDate as string, centerId, bId)))).flat();

  const doc = new jsPDF({ orientation: "landscape" });
  const reportFont = ensureReportFontServer(doc);

  await drawAdditionDisbursedReport(
    doc,
    data,
    { subtitle: `${formatDateLabel(ctx.fromDate)} - ${formatDateLabel(ctx.toDate)}` },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
