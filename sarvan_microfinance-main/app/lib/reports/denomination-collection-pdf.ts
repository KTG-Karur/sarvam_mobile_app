import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { drawPdfReportHeader } from "@/app/lib/reports/pdf-report-header";
import { toDisplayDate, toDisplayDateTime } from '@/app/lib/date-format';

/** Signature shared with the other migrated reports' PdfHeaderDrawer — lets a server caller
 * (no window/DOM) inject its own Node-safe logo/font loading in place of the browser-only
 * drawPdfReportHeader default. */
export type PdfHeaderDrawer = (
  doc: jsPDF,
  title: string,
  opts?: { subtitle?: string; fontFamily?: string }
) => Promise<number>;

export type DenominationKey = "500" | "100" | "50" | "20" | "10" | "coins";

export type DenominationCollectionReportData = {
  summary: {
    totalAmount: number;
    denominations: Record<DenominationKey, number>;
  };
  dailyBreakdown: Array<
    {
      date: string;
      total: number;
    } & Record<DenominationKey, number>
  >;
};

const DENOM_COLUMNS: Array<{ key: DenominationKey; label: string }> = [
  { key: "500", label: "₹500" },
  { key: "100", label: "₹100" },
  { key: "50", label: "₹50" },
  { key: "20", label: "₹20" },
  { key: "10", label: "₹10" },
  { key: "coins", label: "Coins" },
];

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(
    Number.isFinite(amount) ? amount : 0
  );
}

function formatDateLabel(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return ymd;
  return toDisplayDate(d);
}

export interface DenominationCollectionPdfMeta {
  fromDate: string;
  toDate: string;
}

/**
 * Draws the Denomination Collection report — an accent bar + trust header,
 * a summary autoTable section, and a daily-breakdown autoTable section (with
 * a `didParseCell` that bolds/tints only the trailing TOTAL row, and a
 * `didDrawPage` that redraws the accent bar on continuation pages), plus a
 * page-number footer loop — extracted verbatim from the Direct Download PDF
 * logic in components/reports/DenominationCollectionReportClient.tsx's
 * handlePdfExport, so the exact same rendering can be reused by the Request
 * Report queue's PDF builder (via an injected Node-safe `drawHeader`)
 * without duplicating the table logic. `drawHeader` defaults to the browser
 * drawPdfReportHeader, so the existing Direct caller is unaffected by this
 * extraction.
 */
export async function drawDenominationCollectionReport(
  doc: jsPDF,
  data: DenominationCollectionReportData,
  meta: DenominationCollectionPdfMeta,
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const page = {
    w: doc.internal.pageSize.getWidth(),
    h: doc.internal.pageSize.getHeight(),
    marginX: 12,
    marginTop: 12,
    marginBottom: 12,
  } as const;

  const dateRangeLabel = `${formatDateLabel(meta.fromDate)} → ${formatDateLabel(meta.toDate)}`;
  const generatedAtLabel = `Generated: ${toDisplayDateTime(new Date())}`;

  const drawAccentBar = () => {
    // Top accent bar (repeated on continuation pages)
    doc.setFillColor(30, 64, 175); // [#037f35]
    doc.rect(0, 0, page.w, 8, "F");
  };

  const drawFooter = (pageNumber: number, pageCount: number) => {
    doc.setFont(reportFont, "normal");
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139); // slate-500
    doc.text(`Page ${pageNumber} of ${pageCount}`, page.w - page.marginX, page.h - 6, {
      align: "right",
    });
  };

  drawAccentBar();
  const headerY = await drawHeader(doc, "Denomination Collection Report", {
    subtitle: `Date Range: ${dateRangeLabel}    ${generatedAtLabel}`,
    fontFamily: reportFont,
  });

  // NOTE: jsPDF's built-in fonts don't reliably support the Unicode rupee sign.
  // Using ASCII "Rs" avoids broken glyphs and spacing issues in the PDF output.
  const currency = (n: number) => `Rs ${formatCurrency(n)}`;

  const tableTotals = (() => {
    const denoms: Record<DenominationKey, number> = { "500": 0, "100": 0, "50": 0, "20": 0, "10": 0, coins: 0 };
    let total = 0;
    for (const row of data.dailyBreakdown ?? []) {
      for (const c of DENOM_COLUMNS) denoms[c.key] += row[c.key] ?? 0;
      total += row.total ?? 0;
    }
    return { denoms, total };
  })();

  // Summary block (two-row table)
  const summaryRows = [
    ["Total Collection", currency(data.summary.totalAmount), "Days", String(data.dailyBreakdown.length)],
    ...[
      [
        "Rs 500",
        currency(data.summary.denominations["500"] ?? 0),
        "Rs 100",
        currency(data.summary.denominations["100"] ?? 0),
      ],
      [
        "Rs 50",
        currency(data.summary.denominations["50"] ?? 0),
        "Rs 20",
        currency(data.summary.denominations["20"] ?? 0),
      ],
      [
        "Rs 10",
        currency(data.summary.denominations["10"] ?? 0),
        "Coins",
        currency(data.summary.denominations.coins ?? 0),
      ],
    ],
  ];

  autoTable(doc, {
    startY: headerY,
    head: [["Summary", "", "", ""]],
    body: summaryRows,
    theme: "grid",
    styles: {
      font: reportFont,
      fontSize: 10,
      cellPadding: 3,
      textColor: [15, 23, 42],
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
    },
    headStyles: {
      font: reportFont,
      fillColor: [15, 23, 42],
      textColor: [255, 255, 255],
      fontStyle: "bold",
    },
    columnStyles: {
      0: { cellWidth: 38, fontStyle: "bold", fillColor: [248, 250, 252] },
      1: { cellWidth: 48, halign: "right" },
      2: { cellWidth: 38, fontStyle: "bold", fillColor: [248, 250, 252] },
      3: { cellWidth: 48, halign: "right" },
    },
  });

  const afterSummaryY = (doc as any).lastAutoTable?.finalY ?? headerY + 20;

  // Daily breakdown table
  const head = [
    [
      "Date",
      ...DENOM_COLUMNS.map((c) => (c.key === "coins" ? "Coins" : `Rs ${c.key}`)),
      "Total",
    ],
  ];
  const body = data.dailyBreakdown.map((r) => [
    formatDateLabel(r.date),
    ...DENOM_COLUMNS.map((c) => currency(r[c.key] ?? 0)),
    currency(r.total ?? 0),
  ]);
  body.push([
    "TOTAL",
    ...DENOM_COLUMNS.map((c) => currency(tableTotals.denoms[c.key] ?? 0)),
    currency(tableTotals.total),
  ]);

  autoTable(doc, {
    startY: afterSummaryY + 8,
    head,
    body,
    theme: "grid",
    tableLineColor: [226, 232, 240],
    tableLineWidth: 0.2,
    styles: {
      font: reportFont,
      fontSize: 9,
      cellPadding: 2.4,
      textColor: [15, 23, 42],
      valign: "middle",
    },
    headStyles: {
      font: reportFont,
      fillColor: [5, 150, 105], // emerald-600
      textColor: [255, 255, 255],
      fontStyle: "bold",
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { cellWidth: 28, fontStyle: "bold" },
      1: { halign: "right", cellWidth: 25 },
      2: { halign: "right", cellWidth: 25 },
      3: { halign: "right", cellWidth: 25 },
      4: { halign: "right", cellWidth: 25 },
      5: { halign: "right", cellWidth: 25 },
      6: { halign: "right", cellWidth: 25 },
      7: { halign: "right", cellWidth: 25 },
      8: { halign: "right", cellWidth: 28, fontStyle: "bold" },
    },
    didParseCell: (hookData: any) => {
      const isTotalsRow = hookData.section === "body" && hookData.row.index === body.length - 1;
      if (isTotalsRow) {
        hookData.cell.styles.fillColor = [209, 250, 229]; // emerald-100
        hookData.cell.styles.fontStyle = "bold";
      }
    },
    didDrawPage: (hookData: any) => {
      // Re-draw the accent bar on continuation pages (full letterhead only on page 1)
      if (hookData.pageNumber > 1) {
        drawAccentBar();
      }
    },
    margin: { left: page.marginX, right: page.marginX, top: page.marginTop + 10, bottom: page.marginBottom },
  });

  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i += 1) {
    doc.setPage(i);
    drawFooter(i, pageCount);
  }
}
