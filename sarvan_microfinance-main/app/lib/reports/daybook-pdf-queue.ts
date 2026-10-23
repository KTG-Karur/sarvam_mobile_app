import { jsPDF } from "jspdf";
import { format } from "date-fns";
import { prisma } from "@/app/lib/prisma";
import { getDaybookData } from "@/app/lib/actions/reports";
import { isHeadOfficeBranch } from "@/app/lib/head-office-branch";
import { parseDenominationEntryDateUtc } from "@/app/lib/branch-financial-day";
import { drawDaybookReport, type DaybookDenominationEntry } from "@/app/lib/reports/daybook-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

/**
 * Request Report / Request Queue PDF renderer for "daybook" — reuses the
 * exact same drawDaybookReport() the Direct Download PDF uses
 * (app/lib/reports/daybook-pdf.ts), just with Node-safe logo/font loading
 * injected instead of the browser-only defaults.
 *
 * Reuses getDaybookData() from app/lib/actions/reports.ts — the exact same
 * function report-registry.ts's fetchDaybook() already calls — so no query
 * or figure is recalculated for PDF.
 *
 * Also includes the "EOD CASH VERIFICATION" denomination section, which
 * fetchDaybook() intentionally drops (see its own doc comment) because it's
 * a separate DenominationEntry model, not part of the daybook query itself.
 * That data has no session/lock dependency to *read* (only the save/POST
 * path is gated) — it's a plain branchId+entryDate row, looked up directly
 * here exactly like the Direct page's own /api/denomination-entry route
 * does, but for `toDate` only (a daybook's EOD snapshot is always for the
 * closing date, even when fromDate spans a range — matching Direct exactly).
 * If no entry exists for that date, the section is silently omitted, same as
 * this report's existing CSV/Excel/Word behavior via
 * buildDenominationSectionRows.
 */
export async function buildDaybookQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate || !ctx.toDate) {
    throw new Error("fromDate and toDate are required for the Daybook report");
  }
  if (!ctx.branchIds || ctx.branchIds.length !== 1) {
    throw new Error("Select exactly one branch for the Daybook report");
  }
  const branchId = ctx.branchIds[0];
  const isHODaybook = await isHeadOfficeBranch(branchId);

  const branch = await prisma.branch.findUnique({ where: { id: branchId }, select: { code: true, name: true } });
  const branchHeaderLabel = branch ? `${branch.code} - ${branch.name.toUpperCase()}` : "";

  const full = await getDaybookData(ctx.fromDate, ctx.toDate, branchId, 1, 1, isHODaybook, true);

  let denominationEntry: DaybookDenominationEntry | null = null;
  try {
    const entryDate = parseDenominationEntryDateUtc(ctx.toDate);
    const entry = await prisma.denominationEntry.findUnique({
      where: { branchId_entryDate: { branchId, entryDate } },
    });
    if (entry) {
      denominationEntry = {
        d500: entry.d500, d200: entry.d200, d100: entry.d100,
        d50: entry.d50, d20: entry.d20, d10: entry.d10, d5: entry.d5,
        d2: entry.d2, d1: entry.d1, upi: Number(entry.upi),
        remarks: entry.remarks,
      };
    }
  } catch {
    denominationEntry = null;
  }

  const dateRangeLabel = ctx.fromDate === ctx.toDate
    ? format(new Date(ctx.fromDate), "dd/MM/yyyy")
    : `${format(new Date(ctx.fromDate), "dd/MM/yyyy")} TO ${format(new Date(ctx.toDate), "dd/MM/yyyy")}`;

  const doc = new jsPDF({ orientation: "landscape" });
  const reportFont = ensureReportFontServer(doc);

  await drawDaybookReport(
    doc,
    full,
    denominationEntry,
    {
      fromDate: ctx.fromDate,
      toDate: ctx.toDate,
      subtitle: `${branchHeaderLabel ? branchHeaderLabel + "  •  " : ""}${dateRangeLabel.toUpperCase()}`,
    },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
