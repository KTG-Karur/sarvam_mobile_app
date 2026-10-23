import { jsPDF } from "jspdf";
import { getAllBranchDCBData } from "@/app/lib/actions/reports";
import { drawMisAllDcbReport } from "@/app/lib/reports/mis-all-dcb-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import { formatReportAmount } from "@/app/lib/utils/format-amount";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";
import { getLoanAdvanceEnabled } from "@/app/lib/loan-advance-config";
import { toDisplayDate } from '@/app/lib/date-format';

/**
 * Request Report / Request Queue PDF renderer for "mis-all-dcb" — reuses the
 * exact same drawMisAllDcbReport() the Direct Download PDF uses
 * (app/lib/reports/mis-all-dcb-pdf.ts), just with Node-safe logo/font
 * loading injected instead of the browser-only defaults.
 *
 * Reuses getAllBranchDCBData() from app/lib/actions/reports.ts — the exact
 * same function both the live GET /api/reports/all-dcb route and
 * report-registry.ts's fetchMisAllDcb already call — so no query or figure
 * is recalculated for PDF.
 */
function formatDateLabel(dateStr: string): string {
  return toDisplayDate(new Date(dateStr));
}

export async function buildMisAllDcbQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate || !ctx.toDate) {
    throw new Error("fromDate and toDate are required for the All Branch DCB report");
  }

  const data = await getAllBranchDCBData(ctx.fromDate, ctx.toDate, ctx.branchIds ?? undefined);
  const loanAdvanceEnabled = await getLoanAdvanceEnabled();

  const headers = [
    "Branch Name", "Meeting Date", "# Centers", "# Clients", "Opening Arr", "Demand",
    "Current Coll", "Rec %", "Curr Arr Coll", "OD Arr Coll",
    ...(loanAdvanceEnabled ? ["Advance Coll"] : []),
    "Preclosure", "Total Coll", "Curr Arrear", "Closing Arr",
  ];
  const rows: (string | number)[][] = data.map((branch) => [
    `${branch.branchCode} - ${branch.branchName}`, branch.meetingDate, branch.centers, branch.clients,
    formatReportAmount(branch.openingArr), formatReportAmount(branch.demand), formatReportAmount(branch.currentColl), Number(branch.recPercentage.toFixed(2)),
    formatReportAmount(branch.currArrColl), formatReportAmount(branch.odArrColl),
    ...(loanAdvanceEnabled ? [formatReportAmount(branch.advanceColl)] : []),
    formatReportAmount(branch.preclosure),
    formatReportAmount(branch.totalColl), formatReportAmount(branch.currArrear), formatReportAmount(branch.closingArr),
  ]);
  if (data.length > 0) {
    const sum = (fn: (r: (typeof data)[number]) => number) => data.reduce((s, r) => s + fn(r), 0);
    const demand = sum((r) => r.demand);
    const currentColl = sum((r) => r.currentColl);
    const recPercentage = demand > 0 ? (currentColl / demand) * 100 : 0;
    rows.push([
      "Grand Total", "", sum((r) => r.centers), sum((r) => r.clients), formatReportAmount(sum((r) => r.openingArr)), formatReportAmount(demand),
      formatReportAmount(currentColl), Number(recPercentage.toFixed(2)), formatReportAmount(sum((r) => r.currArrColl)),
      formatReportAmount(sum((r) => r.odArrColl)),
      ...(loanAdvanceEnabled ? [formatReportAmount(sum((r) => r.advanceColl))] : []),
      formatReportAmount(sum((r) => r.preclosure)),
      formatReportAmount(sum((r) => r.totalColl)), formatReportAmount(sum((r) => r.currArrear)), formatReportAmount(sum((r) => r.closingArr)),
    ]);
  }

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });
  const reportFont = ensureReportFontServer(doc);

  await drawMisAllDcbReport(
    doc,
    { headers, rows },
    { subtitle: `Period: ${formatDateLabel(ctx.fromDate)} to ${formatDateLabel(ctx.toDate)}` },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
