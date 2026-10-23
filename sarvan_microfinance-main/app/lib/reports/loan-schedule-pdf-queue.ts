import { jsPDF } from "jspdf";
import { prisma } from "@/app/lib/prisma";
import { drawLoanScheduleReport, type LoanScheduleInstallmentRow } from "@/app/lib/reports/loan-schedule-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";
import { getLoanAdvanceEnabled } from "@/app/lib/loan-advance-config";

/**
 * Request Report / Request Queue PDF renderer for "loan-schedule" —
 * reuses the exact same drawLoanScheduleReport() the Direct Download PDF
 * uses (app/lib/reports/loan-schedule-pdf.ts), just with Node-safe
 * logo/font loading injected instead of the browser-only defaults.
 *
 * report-registry.ts's own fetchLoanSchedule computes a DIFFERENT
 * due-vs-paid ledger (not the principal/interest amortization Direct
 * shows), so per the project's data rule this bypasses that divergent
 * registry fetch and replicates GET /api/loans/[loanId]/schedule's own
 * "persisted schedule" computation directly (the common case for a
 * report export — a loan with no persisted schedule yet has nothing to
 * export). This is a bespoke single-loan document, not a filterable
 * multi-row report — one PDF per loanId, no batching.
 */
export async function buildLoanScheduleQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  const loanId = ctx.filters?.loanId;
  if (!loanId) {
    throw new Error("filters.loanId is required for the Loan Schedule report");
  }

  const loan = await prisma.loan.findUnique({
    where: { id: loanId },
    include: {
      client: { select: { firstName: true, lastName: true, clientId: true } },
      center: { select: { name: true } },
      schedules: {
        orderBy: { installmentNo: "asc" },
        select: { installmentNo: true, dueDate: true, principalDue: true, interestDue: true, savingsDue: true, savingsPaid: true },
      },
    },
  });
  if (!loan) throw new Error("Loan not found");
  if (ctx.branchIds && (!loan.branchId || !ctx.branchIds.includes(loan.branchId))) {
    throw new Error("Unauthorized loan access");
  }
  if (loan.schedules.length === 0) {
    throw new Error("No persisted repayment schedule exists yet for this loan");
  }

  const disbursedDate = loan.disbursedByBMAt || loan.disbursedLevel1At || loan.createdAt;

  let runningBalance = Number(loan.amount);
  const schedule: LoanScheduleInstallmentRow[] = loan.schedules.map((scheduleItem) => {
    const totalDue = Number(scheduleItem.principalDue) + Number(scheduleItem.interestDue);
    runningBalance -= Number(scheduleItem.principalDue);
    return {
      installmentNo: scheduleItem.installmentNo,
      dueDate: scheduleItem.dueDate.toISOString(),
      principal: Number(scheduleItem.principalDue).toFixed(2),
      interest: Number(scheduleItem.interestDue).toFixed(2),
      savingsDue: Number(scheduleItem.savingsDue || 0).toFixed(2),
      savingsPaid: Number(scheduleItem.savingsPaid || 0).toFixed(2),
      totalDue: totalDue.toFixed(2),
      balance: Math.max(0, runningBalance).toFixed(2),
    };
  });

  const clientName = `${loan.client.firstName} ${loan.client.lastName || ""}`.trim();

  const doc = new jsPDF({ orientation: "landscape" });
  const reportFont = ensureReportFontServer(doc);

  await drawLoanScheduleReport(
    doc,
    {
      clientName,
      clientId: loan.client.clientId,
      loanNumber: loan.loanNumber,
      centerName: loan.center?.name ?? "",
      amount: Number(loan.amount),
      interestRate: Number(loan.interestRate),
      tenure: loan.tenureMonths,
      frequency: loan.frequency ?? "",
      disbursedDate: disbursedDate ? new Date(disbursedDate).toISOString() : null,
      loanEndDate: null,
    },
    schedule,
    reportFont,
    drawPdfReportHeaderServer,
    await getLoanAdvanceEnabled()
  );

  return Buffer.from(doc.output("arraybuffer"));
}
