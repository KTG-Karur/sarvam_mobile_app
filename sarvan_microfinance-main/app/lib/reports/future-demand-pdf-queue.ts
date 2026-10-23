import { jsPDF } from "jspdf";
import { getFutureDemandData } from "@/app/lib/actions/future-demand";
import { drawFutureDemandReport } from "@/app/lib/reports/future-demand-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";
import { getLoanAdvanceEnabled } from "@/app/lib/loan-advance-config";

const formatDateForDisplay = (dateString: string): string => {
  if (!dateString) return "";
  if (/^[A-Za-z]{3} \d{2} \d{4}$/.test(dateString.trim())) return dateString;
  const date = new Date(dateString);
  if (isNaN(date.getTime())) return dateString;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const day = String(date.getDate()).padStart(2, "0");
  return `${day} ${months[date.getMonth()]} ${date.getFullYear()}`;
};

/**
 * Request Report / Request Queue PDF renderer for "future-demand" —
 * reuses the exact same drawFutureDemandReport() the Direct Download PDF
 * uses (app/lib/reports/future-demand-pdf.ts), just with Node-safe
 * logo/font loading injected instead of the browser-only defaults.
 *
 * Calls getFutureDemandData() directly (app/lib/actions/future-demand.ts)
 * — the exact same function both the live API route and
 * report-registry.ts's fetchFutureDemand call — bypassing that registry
 * wrapper only to access the already-computed `result.totals` it
 * currently discards, so the TOTAL row is built from data already
 * fetched, never a new query, mirroring Direct's own
 * fetchFutureDemandExportRows().
 */
export async function buildFutureDemandQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate || !ctx.toDate) {
    throw new Error("fromDate and toDate are required for the Future Demand report");
  }
  const reportType = (ctx.filters?.reportType as "OFFICERWISE" | "CENTERWISE" | "CLIENTWISE") || "OFFICERWISE";

  const result = await getFutureDemandData({
    fromDate: ctx.fromDate,
    toDate: ctx.toDate,
    reportType,
    page: 1,
    pageSize: 1_000_000,
    branchId: ctx.branchIds ?? undefined,
    centerId: ctx.filters?.centerId,
  });

  const loanAdvanceEnabled = await getLoanAdvanceEnabled();
  let headers: string[];
  if (reportType === "OFFICERWISE") headers = ["Demand Date", "Demand Day", "FDO", "No. of Centers", "No. of Clients", "Demand Pri", "Demand Int", ...(loanAdvanceEnabled ? ["Demand Savings"] : []), "Total Demand"];
  else if (reportType === "CENTERWISE") headers = ["Demand Date", "Demand Day", "Center Name", "No. of Clients", "Demand Pri", "Demand Int", ...(loanAdvanceEnabled ? ["Demand Savings"] : []), "Total Demand"];
  else headers = ["Demand Date", "Demand Day", "Client Name", "Center Name", "Demand Pri", "Demand Int", ...(loanAdvanceEnabled ? ["Demand Savings"] : []), "Total Demand"];

  const rows: (string | number)[][] = result.data.map((row) => {
    const rowData: (string | number)[] = [formatDateForDisplay(row.demandDate), row.demandDay];
    if (reportType === "OFFICERWISE") {
      rowData.push(row.fdo ?? "", row.noOfCenters ?? "", row.noOfClients ?? "");
    } else if (reportType === "CENTERWISE") {
      rowData.push(row.centerName ?? "", row.noOfClients ?? "");
    } else {
      rowData.push(row.clientName ?? "", row.centerName ?? "");
    }
    rowData.push(row.demandPri, row.demandInt);
    if (loanAdvanceEnabled) rowData.push(row.demandSavings || 0);
    rowData.push(row.totalDemand);
    return rowData;
  });

  if (result.totals) {
    const totalsRow: (string | number)[] = ["TOTAL", ""];
    if (reportType === "OFFICERWISE") totalsRow.push("", result.totals.noOfCenters, result.totals.noOfClients);
    else if (reportType === "CENTERWISE") totalsRow.push("", result.totals.noOfClients);
    else totalsRow.push("", "");
    totalsRow.push(result.totals.demandPri, result.totals.demandInt);
    if (loanAdvanceEnabled) totalsRow.push(result.totals.demandSavings || 0);
    totalsRow.push(result.totals.totalDemand);
    rows.push(totalsRow);
  }

  const doc = new jsPDF({ orientation: "landscape" });
  const reportFont = ensureReportFontServer(doc);

  await drawFutureDemandReport(
    doc,
    headers,
    rows,
    { reportType, subtitle: `${formatDateForDisplay(ctx.fromDate)} to ${formatDateForDisplay(ctx.toDate)}` },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
