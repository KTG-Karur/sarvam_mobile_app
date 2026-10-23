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

export const FY_MONTHS = ["apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec", "jan", "feb", "mar"] as const;
export type FYMonth = typeof FY_MONTHS[number];

export const MONTH_LABELS: Record<FYMonth, string> = {
  apr: "Apr", may: "May", jun: "Jun", jul: "Jul", aug: "Aug", sep: "Sep",
  oct: "Oct", nov: "Nov", dec: "Dec", jan: "Jan", feb: "Feb", mar: "Mar",
};

export interface FunderInterestRow {
  funderName: string;
  apr: number; may: number; jun: number; jul: number; aug: number; sep: number;
  oct: number; nov: number; dec: number; jan: number; feb: number; mar: number;
  totalPayment: number;
}

const fmt = (n: number) => formatReportAmount(n);

/**
 * Draws the Funder Interest report — trust header, then a single flat
 * A4-landscape table (no header grouping — grouping exists only in the
 * separate Word export path) with a trailing bold/tinted TOTAL row —
 * extracted verbatim from the Direct Download PDF logic in
 * app/dashboard/admin-reports/funders/funder-interest/page.tsx's
 * handleExportPDF, so the exact same rendering (including the
 * `didParseCell`-driven bold+green TOTAL row) can be reused by the Request
 * Report queue's PDF builder (via an injected Node-safe `drawHeader`)
 * without duplicating the table logic. `drawHeader` defaults to the
 * browser drawPdfReportHeader, so the existing Direct caller is unaffected
 * by this extraction.
 */
export async function drawFunderInterestReport(
  doc: jsPDF,
  rows: FunderInterestRow[],
  grandTotals: Record<FYMonth, number>,
  grandTotal: number,
  meta: { fyLabel: string },
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const head = [["Funder Name", ...FY_MONTHS.map((m) => MONTH_LABELS[m]), "Total Payment"]];
  const body = rows.map((r) => [
    r.funderName,
    ...FY_MONTHS.map((m) => fmt(r[m])),
    fmt(r.totalPayment),
  ]);
  body.push([
    "TOTAL",
    ...FY_MONTHS.map((m) => fmt(grandTotals[m])),
    fmt(grandTotal),
  ]);

  const headerY = await drawHeader(doc, `FUNDER INTEREST REPORT — ${meta.fyLabel}`, {
    fontFamily: reportFont,
  });

  autoTable(doc, {
    head,
    body,
    startY: headerY,
    theme: "grid",
    headStyles: { font: reportFont, fillColor: [30, 64, 175], textColor: 255, fontStyle: "bold", halign: "center" },
    columnStyles: {
      0: { cellWidth: 40 },
      ...Object.fromEntries(
        FY_MONTHS.map((_, i) => [i + 1, { halign: "right" as const, cellWidth: 16 }])
      ),
      13: { halign: "right" as const, fontStyle: "bold" as const, cellWidth: 22 },
    },
    styles: { font: reportFont, fontSize: 7.5, cellPadding: 2 },
    didParseCell: (data) => {
      if (data.row.index === body.length - 1) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [187, 247, 208];
      }
    },
  });
}
