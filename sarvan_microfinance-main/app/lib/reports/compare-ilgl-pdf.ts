import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { drawPdfReportHeader } from "@/app/lib/reports/pdf-report-header";
import { formatReportAmount } from "@/app/lib/utils/format-amount";

/** Signature shared with the other migrated reports' PdfHeaderDrawer — lets a server caller
 * (no window/DOM) inject its own Node-safe logo/font loading in place of the browser-only
 * drawPdfReportHeader default. */
export type PdfHeaderDrawer = (
  doc: jsPDF,
  title: string,
  opts?: { subtitle?: string; fontFamily?: string }
) => Promise<number>;

export interface CompareIlglRow {
  ledger: string;
  tb: number;
  il: number;
  difference: number;
}

const formatCurrency = (amount: number) => formatReportAmount(amount);

/**
 * Draws the IL GL Comparison report — trust header, then a single flat
 * A4-landscape striped table (no Grand Total row, no header grouping) —
 * extracted verbatim from the Direct Download PDF logic in
 * app/dashboard/admin-reports/account/compare-ilgl/page.tsx's
 * handleExport('pdf'), so the exact same rendering can be reused by the
 * Request Report queue's PDF builder (via an injected Node-safe
 * `drawHeader`) without duplicating the table logic. `drawHeader` defaults
 * to the browser drawPdfReportHeader, so the existing Direct caller is
 * unaffected by this extraction.
 *
 * `reportFont` is passed into autoTable's styles below so the table itself renders in the
 * report font (Times New Roman) too — a pre-existing gap where the table used
 * jspdf-autotable's own default font regardless of `reportFont`, fixed as part of the
 * project-wide report export font standardization.
 */
export async function drawCompareIlglReport(
  doc: jsPDF,
  comparisonData: CompareIlglRow[],
  meta: { subtitle: string },
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const headerY = await drawHeader(doc, "IL GL COMPARISON REPORT", {
    subtitle: meta.subtitle,
    fontFamily: reportFont,
  });

  const tableColumn = ["Ledger", "Trial Balance (TB)", "Individual Ledger (IL)", "Difference"];
  const tableRows = comparisonData.map((item) => [
    item.ledger,
    formatCurrency(item.tb),
    formatCurrency(item.il),
    formatCurrency(item.difference),
  ]);

  autoTable(doc, {
    head: [tableColumn],
    body: tableRows,
    startY: headerY,
    theme: "striped",
    styles: { font: reportFont },
    headStyles: { font: reportFont, fillColor: [59, 130, 246] },
  });
}
