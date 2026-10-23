import { jsPDF } from "jspdf";
import { prisma } from "@/app/lib/db";
import { buildFinancialTransactionBranchScope } from "@/app/lib/filters/financial-transaction-branch";
import { drawVoucherPrintReport } from "@/app/lib/reports/voucher-print-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";
import { toDisplayDate } from '@/app/lib/date-format';

/**
 * Request Report / Request Queue PDF renderer for "voucher-print" — reuses the
 * exact same drawVoucherPrintReport() the Direct Download PDF uses
 * (app/lib/reports/voucher-print-pdf.ts). Only the list/summary export
 * (handleExportPDF) is migrated — the single-voucher slip export
 * (handleExportSlipPDF) has no reportSlug/queue entry point in the Direct page
 * and is out of scope.
 *
 * The where-clause here mirrors report-registry.ts's fetchVoucherPrint() (itself
 * already a documented duplicate of GET /api/reports/voucher-print's query, per
 * that function's own comment) rather than calling it directly, because
 * fetchVoucherPrint's ReportRows are shaped for the generic 11-column
 * Excel/CSV/Word export, not the 7-column/TOTAL-row shape this report's PDF
 * table actually shows — reusing it here would mean re-deriving the same
 * column subset and reformatting dates/currency anyway. No new financial
 * calculation is introduced: this only re-selects/reformats fields already
 * queried by fetchVoucherPrint's identical where-clause.
 */

const VOUCHER_TYPE_LABEL: Record<string, string> = {
  BANK_RECEIPT: "Bank Receipt",
  BANK_PAYMENT: "Bank Payment",
  CASH_RECEIPT: "Cash Receipt",
  CASH_PAYMENT: "Cash Payment",
  CONTRA: "Contra",
  JOURNAL: "Journal",
};

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);

const formatDate = (d: Date) =>
  toDisplayDate(d);

export async function buildVoucherPrintQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate) {
    throw new Error("A voucher date is required for the Voucher Print report");
  }
  const startOfDay = new Date(`${ctx.fromDate}T00:00:00`);
  const endOfDay = new Date(`${ctx.fromDate}T23:59:59.999`);
  const typeFilter = ctx.filters?.type;

  const whereClause: Record<string, unknown> = {
    isActive: true,
    transactionDate: { gte: startOfDay, lte: endOfDay },
    ...(typeFilter && typeFilter !== "ALL" ? { type: typeFilter } : {}),
  };
  if (ctx.branchIds) {
    const ors = ctx.branchIds.flatMap(
      (id) => (buildFinancialTransactionBranchScope({ branchId: id }) as { OR?: unknown[] }).OR ?? []
    );
    Object.assign(whereClause, ors.length > 0 ? { OR: ors } : { branchId: "__NO_PERMITTED_BRANCH__" });
  }

  const transactions = await prisma.financialTransaction.findMany({
    where: whereClause,
    include: {
      selfAccount: { select: { name: true } },
      ledger: { select: { ledgerName: true } },
    },
    orderBy: [{ type: "asc" }, { voucherNo: "asc" }],
  });

  let total = 0;
  const rows: (string | number)[][] = transactions.map((tx) => {
    const amount = Number(tx.amount);
    total += amount;
    let drAccount = "";
    let crAccount = "";
    switch (tx.type) {
      case "BANK_RECEIPT":
      case "CASH_RECEIPT":
      case "CONTRA":
        drAccount = tx.selfAccount?.name ?? "";
        crAccount = tx.ledger?.ledgerName ?? "";
        break;
      default:
        drAccount = tx.ledger?.ledgerName ?? "";
        crAccount = tx.selfAccount?.name ?? "";
    }
    return [
      tx.voucherNo,
      VOUCHER_TYPE_LABEL[tx.type] ?? tx.type,
      formatDate(tx.transactionDate),
      drAccount,
      crAccount,
      formatCurrency(amount),
      tx.description ?? "",
    ];
  });
  rows.push(["TOTAL", "", "", "", "", formatCurrency(total), ""]);

  const doc = new jsPDF({ orientation: "landscape" });
  const reportFont = ensureReportFontServer(doc);

  await drawVoucherPrintReport(
    doc,
    rows,
    { subtitle: formatDate(startOfDay) },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
