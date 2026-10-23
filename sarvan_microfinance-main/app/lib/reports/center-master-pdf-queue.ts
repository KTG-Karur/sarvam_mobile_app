import { jsPDF } from "jspdf";
import { getCenterMasterRows } from "@/app/lib/reports/queries/batch3";
import { drawCenterMasterReport } from "@/app/lib/reports/center-master-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

/**
 * Request Report / Request Queue PDF renderer for "center-master" — reuses
 * the exact same drawCenterMasterReport() the Direct Download PDF uses
 * (app/lib/reports/center-master-pdf.ts), just with Node-safe logo/font
 * loading injected instead of the browser-only defaults.
 *
 * Reuses getCenterMasterRows() from app/lib/reports/queries/batch3.ts — the
 * exact same function both the live GET route and report-registry.ts's
 * fetchCenterMaster already call — so no query or figure is recalculated
 * for PDF.
 */
export async function buildCenterMasterQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate) {
    throw new Error("A report date is required for the Center Master report");
  }

  const data = await getCenterMasterRows({ reportDate: ctx.fromDate, branchIds: ctx.branchIds });

  const doc = new jsPDF({ orientation: "landscape" });
  const reportFont = ensureReportFontServer(doc);

  await drawCenterMasterReport(
    doc,
    data,
    { subtitle: `Date: ${ctx.fromDate}` },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
