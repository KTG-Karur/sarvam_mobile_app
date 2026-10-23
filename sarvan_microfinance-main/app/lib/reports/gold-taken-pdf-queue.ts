import { jsPDF } from "jspdf";
import { getGoldTakenReport, type GoldTakenRow, type GoldTakenTotals } from "@/app/lib/actions/reports";
import { drawGoldReportPdf } from "@/app/lib/reports/gold-report-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";
import { truncateReportAmount } from "@/app/lib/utils/format-amount";

function buildGoldTakenExportRows(rows: GoldTakenRow[], totals: GoldTakenTotals): { headers: (string | number)[]; rows: (string | number)[][] } {
  const headers = ["Loan No", "Client Name", "Client ID", "Center", "Branch", "Karat", "Grams", "Gold Value", "Cash Given", "Price/g", "Disbursement Date", "Item", "Reference No.", "Remark"];
  const exportRows = rows.map((r) => [
    r.loanNumber, r.clientName, r.clientId, r.centerName, r.branchName, r.karatType,
    Number(r.gramCount.toFixed(3)), truncateReportAmount(r.goldTakenValue), truncateReportAmount(r.cashGiven), truncateReportAmount(r.pricePerGram), r.disbursementDate,
    r.itemDescription, r.goldTokenNo, r.remarks,
  ]);
  if (rows.length > 0) {
    exportRows.push(["", "Total", "", "", "", "", Number(totals.gramCount.toFixed(3)), truncateReportAmount(totals.goldTakenValue), truncateReportAmount(totals.cashGiven), "", "", "", "", ""]);
  }
  return { headers, rows: exportRows };
}

/**
 * Request Report / Request Queue PDF renderer for "gold-taken" — reuses
 * the exact same drawGoldReportPdf() the Direct Download PDF uses
 * (app/lib/reports/gold-report-pdf.ts), just with Node-safe logo/font
 * loading injected instead of the browser-only defaults.
 *
 * Calls getGoldTakenReport() directly (app/lib/actions/reports.ts) with
 * the same page-looping pattern as Direct's own fetchAllTakenForExport()
 * (the server action clamps pageSize to 5000, so a single call can
 * silently truncate) — bypassing report-registry.ts's fetchGoldTaken.
 * As of Batch 4B, fetchGoldTaken's 14-column shape (incl. Item/Reference
 * No./Remark) and Total row now match this PDF path's own output, but PDF
 * still calls getGoldTakenReport directly rather than reusing fetchGoldTaken,
 * to keep this bespoke renderer independent of report-registry.ts.
 */
export async function buildGoldTakenQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate || !ctx.toDate) {
    throw new Error("fromDate and toDate are required for the Gold Taken report");
  }
  const centerId = ctx.filters?.centerId;

  // preResolvedBranchIds must be passed explicitly (even as null for "all branches") —
  // this queue worker has no cookie session, and leaving it undefined would make
  // getGoldTakenReport fall back to the cookie-based getServerActionUser() lookup, which
  // throws "Authentication required" outside a request context.
  const first = await getGoldTakenReport(ctx.fromDate, ctx.toDate, undefined, centerId, 1, 5000, ctx.branchIds);
  const rows = [...first.rows];
  for (let page = 2; page <= first.totalPages; page++) {
    const next = await getGoldTakenReport(ctx.fromDate, ctx.toDate, undefined, centerId, page, 5000, ctx.branchIds);
    rows.push(...next.rows);
  }

  const { headers, rows: body } = buildGoldTakenExportRows(rows, first.totals);

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const reportFont = ensureReportFontServer(doc);

  await drawGoldReportPdf(doc, "Gold Taken Report", headers, body, { subtitle: `From ${ctx.fromDate} to ${ctx.toDate}` }, reportFont, drawPdfReportHeaderServer);

  return Buffer.from(doc.output("arraybuffer"));
}
