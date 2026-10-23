import { jsPDF } from "jspdf";
import { queryLoans as queryClosedLoans, buildRow as buildClosedLoanRow } from "@/app/api/reports/client/closed-loan-report/route";
import { drawClosedLoanReport } from "@/app/lib/reports/closed-loan-report-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

/**
 * Request Report / Request Queue PDF renderer for "closed-loan-report" —
 * reuses the exact same drawClosedLoanReport() the Direct Download PDF uses
 * (app/lib/reports/closed-loan-report-pdf.ts), just with Node-safe logo/font
 * loading injected instead of the browser-only defaults.
 *
 * Reuses queryLoans/buildRow from
 * app/api/reports/client/closed-loan-report/route.ts — the exact same
 * exported functions both the live GET route and report-registry.ts's
 * fetchClosedLoanReport already call — so no query or figure is
 * recalculated for PDF. The where-clause construction below mirrors
 * fetchClosedLoanReport's own (report-registry.ts), which itself is
 * documented as mirroring the live route's where-clause — this is the same
 * "shared query/compute, format-specific shaping" pattern already used
 * throughout this codebase (report-registry.ts's own comment says so).
 */
export async function buildClosedLoanReportQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate || !ctx.toDate) {
    throw new Error("fromDate and toDate are required for the Closed Loan Report");
  }
  const from = new Date(`${ctx.fromDate}T00:00:00+05:30`);
  const till = new Date(`${ctx.toDate}T23:59:59+05:30`);
  const filters = ctx.filters;

  const branchWhere: any = {};
  if (ctx.branchIds) branchWhere.id = ctx.branchIds.length === 1 ? ctx.branchIds[0] : { in: ctx.branchIds };
  if (filters?.areaId) branchWhere.areas = { some: { id: filters.areaId } };
  else if (filters?.divisionId) branchWhere.areas = { some: { division: { id: filters.divisionId } } };
  else if (filters?.regionId) branchWhere.areas = { some: { division: { region: { id: filters.regionId } } } };

  const loanProductWhere: any = {};
  if (filters?.productTypeId) loanProductWhere.loanProductTypeId = filters.productTypeId;
  if (filters?.loanProductId) loanProductWhere.productId = filters.loanProductId;

  const where: any = {
    isActive: false,
    disbursementStatus: { in: ["DISBURSED", "CLOSED"] },
    ...(filters?.centerId && { centerId: filters.centerId }),
    ...(filters?.funderId && { funderId: filters.funderId }),
    ...(Object.keys(loanProductWhere).length > 0 && { loanProduct: loanProductWhere }),
    ...(Object.keys(branchWhere).length > 0 && { center: { branch: branchWhere } }),
    AND: [{
      OR: [
        { closedDate: { gte: from, lte: till } },
        { transactions: { some: { type: "PRECLOSURE", status: "APPROVED", isReversed: false, transactionDate: { gte: from, lte: till } } } },
        { transactions: { some: { type: "WRITEOFF", status: "APPROVED", isReversed: false, transactionDate: { gte: from, lte: till } } } },
      ],
    }],
  };
  if (filters?.closureType === "PRECLOSED") {
    where.AND.push({ transactions: { some: { type: "PRECLOSURE", status: "APPROVED", isReversed: false } } });
  } else if (filters?.closureType === "WRITTEN_OFF") {
    where.AND.push({ transactions: { some: { type: "WRITEOFF", status: "APPROVED", isReversed: false } } });
  } else if (filters?.closureType === "CLOSED") {
    where.AND.push({ NOT: { transactions: { some: { type: { in: ["PRECLOSURE", "WRITEOFF"] }, status: "APPROVED", isReversed: false } } } });
  }

  const loans = await queryClosedLoans(where, undefined, 5000);
  const allData = loans.map((loan, i) => buildClosedLoanRow(loan, i + 1));

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });
  const reportFont = ensureReportFontServer(doc);

  await drawClosedLoanReport(
    doc,
    allData,
    { subtitle: `Date Range: ${ctx.fromDate} to ${ctx.toDate}  |  Total Loans: ${allData.length}` },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
