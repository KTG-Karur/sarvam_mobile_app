import { jsPDF } from "jspdf";
import { getReportEntry } from "@/app/lib/reports/report-registry";
import { drawCcrReport } from "@/app/lib/reports/ccr-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

/**
 * Request Report / Request Queue PDF renderer for "mcr" (Meeting
 * Collection Report) — reuses drawCcrReport() (app/lib/reports/ccr-pdf.ts)
 * verbatim: fetchMcr (report-registry.ts) is the exact same getCCRData()
 * data as the already-migrated "ccr" report, run through the same shared
 * buildCcrExportRows() helper (just a different last-column label, "Reference
 * No" vs CCR's "Ref No") — so MCR's Direct Download PDF is byte-identical
 * in structure to CCR's, including its title text "CLIENT COLLECTION
 * REPORT" (a pre-existing copy-paste artifact in
 * components/reports/MCRClient.tsx's handleExportPDF, preserved verbatim
 * here rather than "fixed" — Direct is the source of truth, warts and
 * all). Unlike CCR/DCR, MCR's Direct PDF uses plain A4 landscape (no `unit`/
 * `format: 'a3'` override), so this queue builder creates its own jsPDF
 * instance accordingly rather than reusing ccr-pdf-queue.ts's A3 doc.
 */
export async function buildMcrQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate || !ctx.toDate) {
    throw new Error("fromDate and toDate are required for the Meeting Collection Report");
  }

  const entry = getReportEntry("mcr");
  if (!entry?.fetch) {
    throw new Error("Meeting Collection Report is not registered");
  }
  const { headers, rows } = await entry.fetch({
    fromDate: ctx.fromDate,
    toDate: ctx.toDate,
    branchIds: ctx.branchIds,
    filters: ctx.filters,
  });

  const doc = new jsPDF({ orientation: "landscape" });
  const reportFont = ensureReportFontServer(doc);

  await drawCcrReport(
    doc,
    { headers, rows },
    { subtitle: `${ctx.fromDate} to ${ctx.toDate}` },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
