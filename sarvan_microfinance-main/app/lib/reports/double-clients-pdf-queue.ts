import { jsPDF } from "jspdf";
import { getDoubleClientsRows } from "@/app/lib/reports/queries/batch1";
import { drawDoubleClientsReport } from "@/app/lib/reports/double-clients-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

/**
 * Request Report / Request Queue PDF renderer for "double-clients" — reuses
 * the exact same drawDoubleClientsReport() the Direct Download PDF uses
 * (app/lib/reports/double-clients-pdf.ts), just with Node-safe logo/font
 * loading injected instead of the browser-only defaults.
 *
 * Reuses getDoubleClientsRows() from app/lib/reports/queries/batch1.ts —
 * the exact same function both the live GET route and report-registry.ts's
 * fetchDoubleClients already call — so no query or figure is recalculated
 * for PDF.
 */
const SELECTION_TYPE_LABELS: Record<string, string> = {
  OTHER_ID_NO: "OTHER ID NO.",
  SMART_CARD_NO: "SMART CARD NO.",
  VOTER_ID_NO: "VOTERS ID NO.",
  PAN_NO: "PANCARD NO.",
};

export async function buildDoubleClientsQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  const idType = ctx.filters?.idType ?? null;

  const data = await getDoubleClientsRows({
    branchIds: ctx.branchIds,
    centerId: ctx.filters?.centerId ?? null,
    idType,
  });

  const doc = new jsPDF({ orientation: "landscape" });
  const reportFont = ensureReportFontServer(doc);

  await drawDoubleClientsReport(
    doc,
    data,
    { subtitle: `Match Criteria: ${(idType && SELECTION_TYPE_LABELS[idType]) ?? idType ?? ""}` },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
