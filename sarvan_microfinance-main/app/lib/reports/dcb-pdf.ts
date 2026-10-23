import type { jsPDF } from "jspdf";
import autoTable, { CellDef, RowInput } from "jspdf-autotable";
import { drawPdfReportHeader } from "@/app/lib/reports/pdf-report-header";
import type { DCBRow } from "@/app/lib/actions/reports";
import { formatReportAmount } from "@/app/lib/utils/format-amount";

/** Signature shared with the other migrated reports' PdfHeaderDrawer — lets a server caller
 * (no window/DOM) inject its own Node-safe logo/font loading in place of the browser-only
 * drawPdfReportHeader default. */
export type PdfHeaderDrawer = (
  doc: jsPDF,
  title: string,
  opts?: { subtitle?: string; fontFamily?: string }
) => Promise<number>;

export interface DcbPdfMeta {
  /** e.g. "From 01 Jan 2026 to 31 Jan 2026" — matches the Direct page's subtitle exactly. */
  subtitle: string;
}

const formatCurrency = formatReportAmount;

function formatPercentage(value: number): string {
  return value.toFixed(2);
}

// Clean, Excel-style palette for the PDF export — muted top bands for the
// Demand / Collection super-groups, plain white group/sub headers with black
// borders (red text for the arrear labels), and soft highlight fills on the
// computed "total" columns in the body.
const PDF_GRP_COLORS = {
  demandTop: [91, 116, 166] as [number, number, number], // super-group: Demand
  collectTop: [155, 187, 89] as [number, number, number], // super-group: Collection
  white: [255, 255, 255] as [number, number, number],
  black: [0, 0, 0] as [number, number, number],
  red: [192, 0, 0] as [number, number, number],
  highlight: [255, 255, 153] as [number, number, number], // Curr/Total Demand, Total Coll
  muted: [217, 217, 217] as [number, number, number], // Advance Coll
  totalRow: [221, 235, 247] as [number, number, number],
};

// Builds the 3-row grouped header + body rows for the PDF export, mirroring
// the on-screen table's grouping (Demand / Collection super-columns on top,
// group columns below, Pri/Int sub-columns at the bottom) in a plain,
// Excel-style black-on-white grid rather than saturated per-group colors.
function buildDCBGroupedPdfTable(rows: DCBRow[]): { head: RowInput[]; body: RowInput[] } {
  const g = PDF_GRP_COLORS;
  const headBase = { textColor: g.black, fontStyle: "bold" as const, halign: "center" as const, valign: "middle" as const, fillColor: g.white };
  const groupCell = (content: string, colSpan: number, textColor: [number, number, number] = g.black): CellDef => ({
    content, colSpan, styles: { ...headBase, textColor },
  });
  const spanCell = (content: string, rowSpan: number): CellDef => ({ content, rowSpan, styles: headBase });
  const topCell = (content: string, colSpan: number, fillColor: [number, number, number]): CellDef => ({
    content, colSpan, styles: { ...headBase, fillColor, textColor: g.white },
  });
  const piCell = (): CellDef[] => [
    { content: "Pri", styles: { ...headBase, halign: "right" as const } },
    { content: "Int", styles: { ...headBase, halign: "right" as const } },
  ];

  const head: RowInput[] = [
    [
      spanCell("Branch ID", 3), spanCell("Branch", 3), spanCell("Date", 3),
      spanCell("Center ID", 3), spanCell("Center", 3), spanCell("FDO", 3),
      { content: "", colSpan: 2, styles: headBase },
      topCell("Demand", 4, g.demandTop),
      topCell("Collection", 12, g.collectTop),
      { content: "", colSpan: 2, styles: headBase },
      { content: "", colSpan: 2, styles: headBase },
      spanCell("RR %", 3),
    ],
    [
      groupCell("Opening Arrear", 2, g.red),
      groupCell("Curr Demand", 2),
      groupCell("Total Demand", 2),
      groupCell("Arrear Coll", 2),
      groupCell("Curr Dmd Coll", 2),
      groupCell("Advance Coll", 2),
      groupCell("Preclosure", 2),
      groupCell("OD Arrear Coll", 2),
      groupCell("Total Coll", 2),
      groupCell("Curr Arrear", 2, g.red),
      groupCell("Closing Arr", 2),
    ],
    [...piCell(), ...piCell(), ...piCell(), ...piCell(), ...piCell(), ...piCell(), ...piCell(), ...piCell(), ...piCell(), ...piCell(), ...piCell()],
  ];

  // Columns highlighted like the reference sheet: Curr Demand, Total Demand,
  // Total Coll (yellow) and Advance Coll (grey). Index within the 29 body columns
  // (shifted +2 for the new Branch ID / Center ID columns).
  const highlightCols = new Set([8, 9, 10, 11, 22, 23]);
  const mutedCols = new Set([16, 17]);
  const bodyCell = (content: string, colIndex: number, halign: "left" | "right" = "right"): CellDef => {
    const fillColor = highlightCols.has(colIndex) ? g.highlight : mutedCols.has(colIndex) ? g.muted : g.white;
    return { content, styles: { fillColor, textColor: g.black, halign } };
  };

  const body: RowInput[] = rows.map((row) => {
    const values = [
      row.branchCode, row.branchName, row.meetingDate, row.centerCode, row.centerName, row.fdoName,
      formatCurrency(row.openingArrPrincipal), formatCurrency(row.openingArrInterest),
      formatCurrency(row.demandPrincipal), formatCurrency(row.demandInterest),
      formatCurrency(row.openingArrPrincipal + row.demandPrincipal), formatCurrency(row.openingArrInterest + row.demandInterest),
      formatCurrency(row.arrearCollPrincipal), formatCurrency(row.arrearCollInterest),
      formatCurrency(row.currDemandCollPrincipal), formatCurrency(row.currDemandCollInterest),
      formatCurrency(row.advanceCollPrincipal), formatCurrency(row.advanceCollInterest),
      formatCurrency(row.preclosurePrincipal), formatCurrency(row.preclosureInterest),
      formatCurrency(row.odArrearCollPrincipal), formatCurrency(row.odArrearCollInterest),
      formatCurrency(row.totalCollPrincipal), formatCurrency(row.totalCollInterest),
      formatCurrency(row.currArrearPrincipal + row.todayPendingPrincipal), formatCurrency(row.currArrearInterest + row.todayPendingInterest),
      formatCurrency(row.closingArrPrincipal), formatCurrency(row.closingArrInterest),
      `${formatPercentage(row.recPercentage)}%`,
    ];
    return values.map((v, i) => bodyCell(v as string, i, i < 6 ? "left" : "right"));
  });

  if (rows.length > 0) {
    const T = (fn: (r: DCBRow) => number) => rows.reduce((s, r) => s + fn(r), 0);
    const avgRR = T((r) => r.recPercentage) / rows.length;
    const tOAP = T((r) => r.openingArrPrincipal), tOAI = T((r) => r.openingArrInterest);
    const tDP = T((r) => r.demandPrincipal), tDI = T((r) => r.demandInterest);
    const tArCP = T((r) => r.arrearCollPrincipal), tArCI = T((r) => r.arrearCollInterest);
    const tCDCP = T((r) => r.currDemandCollPrincipal), tCDCI = T((r) => r.currDemandCollInterest);
    const tAdvP = T((r) => r.advanceCollPrincipal), tAdvI = T((r) => r.advanceCollInterest);
    const tPreP = T((r) => r.preclosurePrincipal), tPreI = T((r) => r.preclosureInterest);
    const tODP = T((r) => r.odArrearCollPrincipal), tODI = T((r) => r.odArrearCollInterest);
    const tTCP = T((r) => r.totalCollPrincipal), tTCI = T((r) => r.totalCollInterest);
    const tCAP = T((r) => r.currArrearPrincipal + r.todayPendingPrincipal);
    const tCAI = T((r) => r.currArrearInterest + r.todayPendingInterest);
    const tClP = T((r) => r.closingArrPrincipal), tClI = T((r) => r.closingArrInterest);

    const totalRowStyle = { fillColor: g.totalRow, textColor: g.black, fontStyle: "bold" as const };
    const totalCell = (content: string, halign: "left" | "right" = "right"): CellDef => ({ content, styles: { ...totalRowStyle, halign } });
    body.push([
      { content: "GRAND TOTAL", colSpan: 6, styles: totalRowStyle },
      totalCell(formatCurrency(tOAP)), totalCell(formatCurrency(tOAI)),
      totalCell(formatCurrency(tDP)), totalCell(formatCurrency(tDI)),
      totalCell(formatCurrency(tOAP + tDP)), totalCell(formatCurrency(tOAI + tDI)),
      totalCell(formatCurrency(tArCP)), totalCell(formatCurrency(tArCI)),
      totalCell(formatCurrency(tCDCP)), totalCell(formatCurrency(tCDCI)),
      totalCell(formatCurrency(tAdvP)), totalCell(formatCurrency(tAdvI)),
      totalCell(formatCurrency(tPreP)), totalCell(formatCurrency(tPreI)),
      totalCell(formatCurrency(tODP)), totalCell(formatCurrency(tODI)),
      totalCell(formatCurrency(tTCP)), totalCell(formatCurrency(tTCI)),
      totalCell(formatCurrency(tCAP)), totalCell(formatCurrency(tCAI)),
      totalCell(formatCurrency(tClP)), totalCell(formatCurrency(tClI)),
      totalCell(`${avgRR.toFixed(2)}%`),
    ]);
  }

  return { head, body };
}

/**
 * Draws the DCB (Demand Collection Balance) report — trust header, then a
 * single autoTable with a genuine 3-row grouped header (identity columns
 * rowSpan-3, Demand/Collection colored super-bands, group labels, Pri/Int
 * sub-headers) and a 29-column body with highlighted "total" columns and a
 * GRAND TOTAL row — extracted verbatim from the Direct Download PDF logic in
 * components/reports/DCBClient.tsx's handleExportPDF /
 * buildDCBGroupedPdfTable, so the exact same rendering can be reused by the
 * Request Report queue's PDF builder (via an injected Node-safe
 * `drawHeader`) without duplicating the table logic. `drawHeader` defaults
 * to the browser drawPdfReportHeader, so the existing Direct caller is
 * unaffected by this extraction.
 *
 * Note: this 29-column PDF shape is narrower than the 32-column shape used by
 * report-registry.ts's fetchDcb (Excel/CSV/Word) — the PDF's Opening
 * Arrear/Curr Demand/Total Demand groups have only Pri/Int, no separate Total
 * sub-column. This mirrors the Direct PDF exactly; it does not touch the
 * 32-column Excel/CSV/Word shape.
 */
export async function drawDcbReport(
  doc: jsPDF,
  rows: DCBRow[],
  meta: DcbPdfMeta,
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const { head, body } = buildDCBGroupedPdfTable(rows);
  const headerY = await drawHeader(doc, "DCB REPORT — DEMAND COLLECTION BALANCE", {
    subtitle: meta.subtitle,
    fontFamily: reportFont,
  });
  autoTable(doc, {
    startY: headerY,
    head,
    body,
    theme: "grid",
    styles: { fontSize: 7, cellPadding: 1.5, lineColor: [0, 0, 0], lineWidth: 0.1, textColor: [0, 0, 0], font: reportFont },
  });
}
