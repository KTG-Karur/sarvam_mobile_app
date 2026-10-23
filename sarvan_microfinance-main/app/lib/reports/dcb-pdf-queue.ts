import { jsPDF } from "jspdf";
import { getDCBData } from "@/app/lib/actions/reports";
import { drawDcbReport } from "@/app/lib/reports/dcb-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

/**
 * Request Report / Request Queue PDF renderer for "dcb" — reuses the exact
 * same drawDcbReport() the Direct Download PDF uses
 * (app/lib/reports/dcb-pdf.ts), just with Node-safe logo/font loading
 * injected instead of the browser-only defaults.
 *
 * Reuses getDCBData() from app/lib/actions/reports.ts — the exact same
 * Server Action both DCBClient.tsx's on-screen table and
 * report-registry.ts's fetchDcb already call — so no query or figure is
 * recalculated for PDF.
 */
export async function buildDcbQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate || !ctx.toDate) {
    throw new Error("fromDate and toDate are required for the Demand Collection Balance report");
  }

  const rows = await getDCBData(ctx.fromDate, ctx.toDate, undefined, ctx.filters?.centerId, ctx.branchIds);

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });
  const reportFont = ensureReportFontServer(doc);

  await drawDcbReport(
    doc,
    rows,
    { subtitle: `From ${ctx.fromDate} to ${ctx.toDate}` },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
