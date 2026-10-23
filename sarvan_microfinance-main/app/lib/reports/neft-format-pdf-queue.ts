import { jsPDF } from "jspdf";
import { prisma } from "@/app/lib/db";
import { getReportEntry } from "@/app/lib/reports/report-registry";
import { drawNeftFormatReport } from "@/app/lib/reports/neft-format-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

/**
 * Request Report / Request Queue PDF renderer for "neft-format" — reuses the
 * exact same drawNeftFormatReport() the Direct Download PDF uses
 * (app/lib/reports/neft-format-pdf.ts), just with Node-safe logo/font
 * loading injected instead of the browser-only defaults.
 *
 * Reuses the report registry's own fetchNeftFormat() (via getReportEntry)
 * for row data — the exact same adapter already used for this report's
 * Excel/CSV/Word queue exports, and its 16-column shape (plus trailing
 * Grand Total row) already matches the Direct PDF's row shape exactly. The
 * index numbers (needed only for the subtitle, not part of ReportRows) are
 * looked up separately via a single cheap LoanIndex read.
 */
export async function buildNeftFormatQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  const indexIds = ctx.filters?.indexIds?.split(",").map((s) => s.trim()).filter(Boolean);
  if (!indexIds || indexIds.length === 0) {
    throw new Error("filters.indexIds is required for the NEFT Format report");
  }

  const entry = getReportEntry("neft-format");
  if (!entry?.fetch) {
    throw new Error("NEFT Format report is not registered");
  }
  const { headers, rows } = await entry.fetch({
    fromDate: ctx.fromDate,
    toDate: ctx.toDate,
    branchIds: ctx.branchIds,
    filters: ctx.filters,
  });

  const indexes = await prisma.loanIndex.findMany({
    where: { id: { in: indexIds } },
    select: { indexNo: true },
  });
  const indexLabel = indexes.map((i) => i.indexNo).join(", ");

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a3" });
  const reportFont = ensureReportFontServer(doc);

  await drawNeftFormatReport(
    doc,
    { headers, rows },
    { subtitle: `Index Number(s): ${indexLabel}` },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
