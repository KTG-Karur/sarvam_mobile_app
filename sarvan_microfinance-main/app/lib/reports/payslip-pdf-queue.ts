import { jsPDF } from "jspdf";
import { prisma } from "@/app/lib/db";
import { getActiveBrandNames } from "@/app/lib/brand-server";
import { drawPayslipReport, type PayslipData } from "@/app/lib/reports/payslip-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

/**
 * Request Report / Request Queue PDF renderer for "payslip" — BESPOKE
 * document (manual header/info-grid/net-pay-banner/signatures, not a
 * flat-table report). Reuses the exact same drawPayslipReport() the
 * Direct Download PDF uses (app/lib/reports/payslip-pdf.ts), just with
 * Node-safe logo/font loading injected instead of the browser-only
 * defaults.
 *
 * report-registry.ts's own fetchPayslip reconstructs a generic 5-column
 * Field/Value ReportRows shape for Excel/CSV/Word (explicitly a
 * "force-fit" per its own comment) — it is not reused here. This queue
 * builder instead replicates GET /api/payroll/payslip's own computation
 * directly (same prisma.user / prisma.salaryPayRecord queries), since
 * that is the actual authoritative data source Direct's PayslipClient.tsx
 * calls, so Queue and Direct produce identical figures.
 */
export async function buildPayslipQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  const employeeId = ctx.filters?.employeeId;
  const month = ctx.filters?.month ? parseInt(ctx.filters.month, 10) : NaN;
  const year = ctx.filters?.year ? parseInt(ctx.filters.year, 10) : NaN;
  if (!employeeId) throw new Error("filters.employeeId is required for the Payslip report");
  if (isNaN(month) || month < 1 || month > 12) throw new Error("filters.month must be a number between 1 and 12");
  if (isNaN(year) || year < 2020) throw new Error("filters.year must be a valid year (>= 2020)");

  const employee = await prisma.user.findUnique({
    where: { id: employeeId },
    select: {
      firstName: true, lastName: true, employeeId: true, role: true, branchId: true,
      branch: { select: { name: true, code: true } },
    },
  });
  if (!employee) throw new Error("Employee not found");
  if (ctx.branchIds && (!employee.branchId || !ctx.branchIds.includes(employee.branchId))) {
    throw new Error("You do not have access to this employee's payslip");
  }

  const payRecord = await prisma.salaryPayRecord.findUnique({
    where: { employeeId_month_year: { employeeId, month, year } },
    include: {
      lineItems: {
        include: { salaryComponent: { select: { name: true, type: true } } },
        orderBy: { salaryComponent: { salaryId: "asc" } },
      },
    },
  });
  if (!payRecord) {
    throw new Error(`No salary record found for ${employee.firstName} ${employee.lastName} for the selected period.`);
  }

  const components = payRecord.lineItems.map((item) => ({
    name: item.salaryComponent.name,
    type: item.salaryComponent.type as "EARNINGS" | "DEDUCTIONS",
    amount: Number(item.amount),
  }));

  const data: PayslipData = {
    employeeName: `${employee.firstName} ${employee.lastName}`,
    employeeCode: employee.employeeId ?? "N/A",
    designation: employee.role,
    department: "General",
    branchName: employee.branch?.name ?? "N/A",
    branchCode: employee.branch?.code ?? "N/A",
    month,
    year,
    paymentType: payRecord.paymentType,
    status: payRecord.status,
    paidOn: payRecord.createdAt.toISOString(),
    components,
    totalEarnings: Number(payRecord.totalEarnings),
    totalDeductions: Number(payRecord.totalDeductions),
    netPayable: Number(payRecord.netPayable),
  };

  const { companyNameFull } = await getActiveBrandNames();

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const reportFont = ensureReportFontServer(doc);

  await drawPayslipReport(doc, data, companyNameFull, reportFont, drawPdfReportHeaderServer);

  return Buffer.from(doc.output("arraybuffer"));
}
