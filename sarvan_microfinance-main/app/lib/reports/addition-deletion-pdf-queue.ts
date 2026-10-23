import { jsPDF } from "jspdf";
import { getAdditionDeletionRows } from "@/app/lib/reports/queries/batch1";
import { drawAdditionDeletionReport } from "@/app/lib/reports/addition-deletion-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import { truncateReportAmount } from "@/app/lib/utils/format-amount";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

/**
 * Request Report / Request Queue PDF renderer for "addition-deletion" —
 * reuses the exact same drawAdditionDeletionReport() the Direct Download PDF
 * uses (app/lib/reports/addition-deletion-pdf.ts), just with Node-safe
 * logo/font loading injected instead of the browser-only defaults.
 *
 * Reuses getAdditionDeletionRows() from app/lib/reports/queries/batch1.ts —
 * the exact same function both the live GET route and report-registry.ts's
 * fetchAdditionDeletion already call — so no query or figure is
 * recalculated for PDF. Direct's PDF appends a trailing "Grand Total" row
 * that fetchAdditionDeletion itself doesn't include; it's added here the
 * same way Direct builds it — summing the already-fetched columns, not a
 * new query.
 */
export async function buildAdditionDeletionQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate || !ctx.toDate) {
    throw new Error("fromDate and toDate are required for the Addition & Deletion report");
  }

  const data = await getAdditionDeletionRows({
    fromDate: ctx.fromDate,
    toDate: ctx.toDate,
    branchIds: ctx.branchIds,
    centerId: ctx.filters?.centerId ?? null,
  });

  const headers = ["Sl No", "FDO", "Center", "Opening", "Induction", "Dropped", "Closing", "Admission Fees"];
  const rows: (string | number)[][] = data.map((r, i) => [i + 1, r.fdo, r.centerName, r.opening, r.induction, r.dropped, r.closing, truncateReportAmount(r.admissionFees)]);
  if (data.length > 0) {
    const sum = (fn: (r: (typeof data)[number]) => number) => data.reduce((a, c) => a + fn(c), 0);
    rows.push([
      "", "Grand Total:", "",
      sum((r) => r.opening || 0), sum((r) => r.induction || 0), sum((r) => r.dropped || 0), sum((r) => r.closing || 0), truncateReportAmount(sum((r) => r.admissionFees || 0)),
    ]);
  }

  const doc = new jsPDF({ orientation: "landscape" });
  const reportFont = ensureReportFontServer(doc);

  await drawAdditionDeletionReport(
    doc,
    { headers, rows },
    { subtitle: `${ctx.fromDate} to ${ctx.toDate}` },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
