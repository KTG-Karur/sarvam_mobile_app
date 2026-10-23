import { jsPDF } from "jspdf";
import { getOSBranchwiseData } from "@/app/lib/actions/reports";
import { drawOsBranchwiseReport } from "@/app/lib/reports/os-branchwise-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import { truncateReportAmount } from "@/app/lib/utils/format-amount";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";
import { getLoanAdvanceEnabled } from "@/app/lib/loan-advance-config";
import { toDisplayDate } from '@/app/lib/date-format';

/**
 * Request Report / Request Queue PDF renderer for "os-branchwise" — reuses the
 * exact same drawOsBranchwiseReport() the Direct Download PDF uses
 * (app/lib/reports/os-branchwise-pdf.ts), just with Node-safe logo/font
 * loading injected instead of the browser-only defaults.
 *
 * Reuses getOSBranchwiseData() from app/lib/actions/reports.ts — the exact
 * same function both the live GET /api/reports/os-branchwise route and
 * report-registry.ts's fetchOSBranchwise already call — so no query or figure
 * is recalculated for PDF.
 */
export async function buildOsBranchwiseQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate) {
    throw new Error("A report date is required for the Outstanding Branchwise report");
  }
  const data = await getOSBranchwiseData(ctx.fromDate, ctx.branchIds ?? undefined);
  const loanAdvanceEnabled = await getLoanAdvanceEnabled();

  const headers = [
    "Branch Code", "Branch Name", "No. of Clients", "OS Principal", "OS Interest",
    ...(loanAdvanceEnabled ? ["OS Loan Advance"] : []),
    "Arr. Clients", "Arrear Principal", "Arrear Interest",
    ...(loanAdvanceEnabled ? ["Arrear Loan Advance"] : []),
  ];
  const rows: (string | number)[][] = data.map((branch) => [
    branch.branchCode,
    branch.branchName,
    branch.noOfClients,
    truncateReportAmount(branch.osPrincipal),
    truncateReportAmount(branch.osInterest),
    ...(loanAdvanceEnabled ? [truncateReportAmount(branch.osSavings || 0)] : []),
    branch.arrClients,
    truncateReportAmount(branch.arrearPri),
    truncateReportAmount(branch.arrearInt),
    ...(loanAdvanceEnabled ? [truncateReportAmount(branch.arrearSavings || 0)] : []),
  ]);
  const totals = data.reduce(
    (acc, branch) => ({
      noOfClients: acc.noOfClients + branch.noOfClients,
      osPrincipal: acc.osPrincipal + branch.osPrincipal,
      osInterest: acc.osInterest + branch.osInterest,
      osSavings: acc.osSavings + (branch.osSavings || 0),
      arrClients: acc.arrClients + branch.arrClients,
      arrearPri: acc.arrearPri + branch.arrearPri,
      arrearInt: acc.arrearInt + branch.arrearInt,
      arrearSavings: acc.arrearSavings + (branch.arrearSavings || 0),
    }),
    { noOfClients: 0, osPrincipal: 0, osInterest: 0, osSavings: 0, arrClients: 0, arrearPri: 0, arrearInt: 0, arrearSavings: 0 }
  );
  rows.push([
    "", "GRAND TOTAL", totals.noOfClients, truncateReportAmount(totals.osPrincipal), truncateReportAmount(totals.osInterest),
    ...(loanAdvanceEnabled ? [truncateReportAmount(totals.osSavings)] : []),
    totals.arrClients, truncateReportAmount(totals.arrearPri), truncateReportAmount(totals.arrearInt),
    ...(loanAdvanceEnabled ? [truncateReportAmount(totals.arrearSavings)] : []),
  ]);

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const reportFont = ensureReportFontServer(doc);

  await drawOsBranchwiseReport(
    doc,
    { headers, rows },
    { subtitle: `As of ${toDisplayDate(new Date(ctx.fromDate))}` },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
