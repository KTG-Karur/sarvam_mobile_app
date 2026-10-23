import { jsPDF } from "jspdf";
import { prisma } from "@/app/lib/db";
import { getReportEntry } from "@/app/lib/reports/report-registry";
import { drawOpeningBalanceReport } from "@/app/lib/reports/opening-balance-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

/**
 * Request Report / Request Queue PDF renderer for "opening-balance" — reuses the
 * exact same drawOpeningBalanceReport() the Direct Download PDF uses
 * (app/lib/reports/opening-balance-pdf.ts), just with Node-safe logo/font loading
 * (drawPdfReportHeaderServer / ensureReportFontServer) injected instead of the
 * browser-only defaults — so the queued PDF is structurally and visually the
 * same report, not the generic flat-table Puppeteer layout.
 *
 * Reuses the report registry's own fetchOpeningBalance() (via getReportEntry) for
 * data — the exact same adapter already used for this report's Excel/CSV/Word
 * queue exports — so no query or figure is recalculated for PDF.
 */
export async function buildOpeningBalanceQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  const branchId = ctx.branchIds?.[0];
  if (!branchId || ctx.branchIds?.length !== 1) {
    throw new Error("A single branch is required for the Opening Balance report");
  }

  const entry = getReportEntry("opening-balance");
  if (!entry?.fetch) {
    throw new Error("Opening Balance report is not registered");
  }
  const { headers, rows } = await entry.fetch({
    fromDate: ctx.fromDate,
    toDate: ctx.toDate,
    branchIds: ctx.branchIds,
    filters: ctx.filters,
  });

  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { code: true, name: true },
  });

  const doc = new jsPDF({ orientation: "landscape" });
  const reportFont = ensureReportFontServer(doc);

  await drawOpeningBalanceReport(
    doc,
    { headers, rows },
    { subtitle: branch ? `Branch: ${branch.code} - ${branch.name}` : "" },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
