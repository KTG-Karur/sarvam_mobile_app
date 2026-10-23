import { jsPDF } from "jspdf";
import { getClientwiseDCBData } from "@/app/lib/actions/reports";
import { drawClientwiseDcbReport } from "@/app/lib/reports/clientwise-dcb-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";
import { getLoanAdvanceEnabled } from "@/app/lib/loan-advance-config";
import { toDisplayDate } from '@/app/lib/date-format';

/**
 * Request Report / Request Queue PDF renderer for "clientwise-dcb" — reuses
 * the exact same drawClientwiseDcbReport() the Direct Download PDF uses
 * (app/lib/reports/clientwise-dcb-pdf.ts), just with Node-safe logo/font
 * loading injected instead of the browser-only defaults.
 *
 * Reuses getClientwiseDCBData() from app/lib/actions/reports.ts — the exact
 * same function both the live GET route and report-registry.ts's
 * fetchClientwiseDcb already call — so no query or figure is recalculated
 * for PDF.
 *
 * Note: the Direct page for this report doesn't use the shared
 * ExportDropdown component (bespoke buttons calling its own API route
 * directly), so today no UI action can actually set reportSlug and reach
 * the Request Queue for this report — this migration keeps rendering in
 * parity for whenever that's wired up, without touching the page's export
 * UI itself (out of scope for a pure PDF-parity migration).
 */
export async function buildClientwiseDcbQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate || !ctx.toDate) {
    throw new Error("fromDate and toDate are required for the Clientwise DCB report");
  }
  const centerId = ctx.filters?.centerId || "all";

  const data = await getClientwiseDCBData(ctx.fromDate, ctx.toDate, centerId, ctx.branchIds ?? undefined);

  const doc = new jsPDF({ orientation: "landscape" });
  const reportFont = ensureReportFontServer(doc);

  const dateLabel = `${toDisplayDate(new Date(ctx.fromDate))} - ${toDisplayDate(new Date(ctx.toDate))}`;

  await drawClientwiseDcbReport(
    doc,
    data,
    { subtitle: dateLabel },
    reportFont,
    drawPdfReportHeaderServer,
    await getLoanAdvanceEnabled()
  );

  return Buffer.from(doc.output("arraybuffer"));
}
