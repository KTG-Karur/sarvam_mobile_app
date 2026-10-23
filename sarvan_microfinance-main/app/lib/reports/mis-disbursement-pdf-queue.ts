import { jsPDF } from "jspdf";
import { prisma } from "@/app/lib/db";
import { getReportEntry } from "@/app/lib/reports/report-registry";
import { drawMisDisbursementReport } from "@/app/lib/reports/mis-disbursement-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";
import { toDisplayDate } from '@/app/lib/date-format';

/**
 * Request Report / Request Queue PDF renderer for "mis-disbursement" —
 * reuses the exact same drawMisDisbursementReport() the Direct Download PDF
 * uses (app/lib/reports/mis-disbursement-pdf.ts), just with Node-safe
 * logo/font loading injected instead of the browser-only defaults.
 *
 * Reuses the report registry's own fetchMisDisbursement() (via
 * getReportEntry) for row data — the exact same adapter already used for
 * this report's Excel/CSV/Word queue exports, whose 18-column shape already
 * matches the Direct PDF's row shape exactly — so no query or figure is
 * recalculated for PDF. Direct's PDF appends a trailing "Grand Total" row
 * that fetchMisDisbursement itself doesn't include (Excel/CSV/Word don't
 * need one baked into the rows); it's added here the same way Direct builds
 * it — summing the already-fetched Loan Amount column, not a new query.
 */
function formatDateLabel(dateStr: string): string {
  return toDisplayDate(new Date(dateStr));
}

export async function buildMisDisbursementQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate || !ctx.toDate) {
    throw new Error("fromDate and toDate are required for the MIS Disbursement report");
  }

  const entry = getReportEntry("mis-disbursement");
  if (!entry?.fetch) {
    throw new Error("MIS Disbursement report is not registered");
  }
  const { headers, rows } = await entry.fetch({
    fromDate: ctx.fromDate,
    toDate: ctx.toDate,
    branchIds: ctx.branchIds,
    filters: ctx.filters,
  });

  if (rows.length > 0) {
    const totalLoanAmount = rows.reduce((sum, r) => sum + Number(r[9] || 0), 0);
    rows.push(["Grand Total", "", "", "", "", "", "", "", "", totalLoanAmount, "", "", "", "", "", "", "", ""]);
  }

  let centerLabel: string | null = null;
  const centerId = ctx.filters?.centerId;
  if (centerId && centerId !== "all") {
    const center = await prisma.center.findUnique({ where: { id: centerId }, select: { code: true, name: true } });
    centerLabel = center ? `${center.code} - ${center.name}` : centerId;
  }

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });
  const reportFont = ensureReportFontServer(doc);

  await drawMisDisbursementReport(
    doc,
    { headers, rows },
    {
      subtitle: `Period: ${formatDateLabel(ctx.fromDate)} to ${formatDateLabel(ctx.toDate)}${centerLabel ? `  •  Center: ${centerLabel}` : ""}`,
    },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
