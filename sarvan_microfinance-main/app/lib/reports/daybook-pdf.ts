import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { format, parse } from "date-fns";
import { isValid } from "date-fns";
import { drawPdfReportHeader } from "@/app/lib/reports/pdf-report-header";
import { DENOMINATION_UI_ROWS } from "@/components/utilities/denomination-ui-rows";
import type { DaybookResult } from "@/app/lib/actions/reports";
import { formatReportAmount } from "@/app/lib/utils/format-amount";

/** Signature shared with the other migrated reports' PdfHeaderDrawer — lets a server caller
 * (no window/DOM) inject its own Node-safe logo/font loading in place of the browser-only
 * drawPdfReportHeader default. */
export type PdfHeaderDrawer = (
  doc: jsPDF,
  title: string,
  opts?: { subtitle?: string; fontFamily?: string }
) => Promise<number>;

export interface DaybookDenominationEntry {
  d500: number; d200: number; d100: number;
  d50: number; d20: number; d10: number; d5: number;
  d2: number; d1: number; upi: number;
  remarks?: string | null;
}

export interface DaybookPdfMeta {
  fromDate: string;
  toDate: string;
  subtitle: string;
}

const fmtNum = (amount: number): string => formatReportAmount(amount);

/** Server sends "02 Jun 2026" → we display "02-06-2026" */
function fmtDate(dateStr: string): string {
  try {
    const d = parse(dateStr, "dd/MM/yyyy", new Date());
    return format(d, "dd/MM/yyyy");
  } catch {
    return dateStr;
  }
}

/** Guards against an empty/incomplete date string so it can't crash with date-fns's
 * "Invalid time value". */
function safeFmtInputDate(dateStr: string, pattern: string): string {
  const d = new Date(dateStr);
  return isValid(d) ? format(d, pattern) : "";
}

const voucherTypeLabel = (type: string): string => {
  const t = (type ?? "").toUpperCase();
  if (t === "CR") return "Cash Receipt";
  if (t === "CP" || t === "DR") return "Cash Payment";
  return type;
};

// jsPDF's built-in standard fonts (Times included) have no glyph for ₹ (U+20B9) — strip it from PDF cell text only.
const stripRupeeForPdf = (s: string): string => s.replace(/₹/g, "");

function sortDaybookTransactions(txns: DaybookResult["transactions"]) {
  return txns.slice().sort((a, b) => {
    try {
      const da = parse(a.date, "dd/MM/yyyy", new Date()).getTime();
      const db = parse(b.date, "dd/MM/yyyy", new Date()).getTime();
      if (da !== db) return da - db;
      const aR = a.credit > 0;
      const bR = b.credit > 0;
      if (aR && !bR) return -1;
      if (!aR && bR) return 1;
      return (a.particulars || "").localeCompare(b.particulars || "");
    } catch {
      return 0;
    }
  });
}

function calcDenomTotal(e: DaybookDenominationEntry | null): number {
  if (!e) return 0;
  return (
    e.d500 * 500 + e.d200 * 200 + e.d100 * 100 +
    e.d50 * 50 + e.d20 * 20 + e.d10 * 10 + e.d5 * 5 + e.d2 * 2 + e.d1 + e.upi
  );
}

/**
 * Draws the Daybook report — trust header, the transactions table (Opening
 * Balance / sorted transactions / Total / Closing Balance, with colored
 * voucher-type pill badges and tinted Opening/Total/Closing rows via
 * didParseCell/didDrawCell), and — when a denomination entry is supplied —
 * an "EOD CASH VERIFICATION" section on its own table — extracted verbatim
 * from the Direct Download PDF logic in
 * app/dashboard/admin-reports/account/daybook/page.tsx's handleExportPdf, so
 * the exact same rendering can be reused by the Request Report queue's PDF
 * builder (via an injected Node-safe `drawHeader`) without duplicating the
 * table logic. `drawHeader` defaults to the browser drawPdfReportHeader, so
 * the existing Direct caller is unaffected by this extraction.
 */
export async function drawDaybookReport(
  doc: jsPDF,
  full: DaybookResult,
  denominationEntry: DaybookDenominationEntry | null,
  meta: DaybookPdfMeta,
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const margin = 10;
  const fullSorted = sortDaybookTransactions(full.transactions);
  const fullOb = full.openingBalance;
  const fullDrTotal = full.openingBalance + full.totalCredits;
  const fullCrTotal = full.totalDebits;
  const fullCb = full.closingBalance;
  const fullCbNegative = fullCb < 0;

  const y = await drawHeader(doc, "DAYBOOK REPORT", {
    subtitle: meta.subtitle,
    fontFamily: reportFont,
  });

  // 7 columns — same shape/order as the on-screen table, minus the trailing "Print"
  // column (a per-row print button has no meaning in a static PDF, and dropping it
  // frees the width the real columns need to sit on one line).
  const head = [["S.No", "Date", "Voucher Type", "Voucher No", "Particulars", "Debit Rs.", "Credit Rs."]];
  const body: any[] = [];
  body.push(["", safeFmtInputDate(meta.fromDate, "dd/MM/yyyy"), "Opening Balance", "", "Opening Balance", fmtNum(fullOb), ""]);

  fullSorted.forEach((tx, i) => {
    const isRcpt = tx.credit > 0;
    body.push([
      String(i + 1),
      fmtDate(tx.date),
      voucherTypeLabel(tx.type),
      tx.refNo || "",
      stripRupeeForPdf((tx.particulars || "") + (tx.description ? `\n${tx.description}` : "")),
      isRcpt ? fmtNum(tx.credit) : "",
      !isRcpt ? fmtNum(tx.debit) : "",
    ]);
  });

  body.push(["", "", "Total", "", "", fmtNum(fullDrTotal), fmtNum(fullCrTotal)]);
  if (fullCbNegative) {
    body.push(["", safeFmtInputDate(meta.toDate, "dd/MM/yyyy"), "Closing Balance", "", "Closing Balance (Overdraft)", "", fmtNum(Math.abs(fullCb))]);
  } else {
    body.push(["", safeFmtInputDate(meta.toDate, "dd/MM/yyyy"), "Closing Balance", "", "Closing Balance", fmtNum(fullCb), ""]);
  }

  // Palette mirrors the on-screen table's badge/highlight colors
  // (bg-green-100/text-green-800, bg-red-100/text-red-800, bg-amber-50, bg-gray-100).
  const COLOR_GREEN_BG: [number, number, number] = [220, 252, 231];
  const COLOR_GREEN_TEXT: [number, number, number] = [22, 101, 52];
  const COLOR_RED_BG: [number, number, number] = [254, 226, 226];
  const COLOR_RED_TEXT: [number, number, number] = [153, 27, 27];
  const COLOR_AMBER_BG: [number, number, number] = [255, 251, 235];
  const COLOR_GRAY_BG: [number, number, number] = [243, 244, 246];

  autoTable(doc, {
    startY: y, head, body, theme: "grid",
    // Dark slate header bar matching the on-screen `bg-gray-800` (rgb 31,41,55).
    headStyles: {
      font: reportFont, fillColor: [31, 41, 55], textColor: 255, fontStyle: "bold", fontSize: 8.5,
      halign: "center", valign: "middle", cellPadding: { top: 2.5, bottom: 2.5, left: 2, right: 2 },
      lineColor: [31, 41, 55], lineWidth: 0.1,
    },
    // Compact, report-grade body text (~8.5pt) with hairline grey rules, vertically
    // centred like the on-screen table. Zebra striping via alternateRowStyles; the
    // tinted Opening/Total/Closing rows are painted in didParseCell and win over it.
    styles: {
      font: reportFont, fontSize: 8.5, cellPadding: { top: 2, bottom: 2, left: 2, right: 2 },
      valign: "middle", overflow: "linebreak", lineColor: [226, 232, 240], lineWidth: 0.1,
      textColor: [31, 41, 55],
    },
    alternateRowStyles: { fillColor: [248, 250, 252] },
    columnStyles: {
      0: { cellWidth: 12, halign: "center", fontSize: 7.5, textColor: [100, 116, 139] },
      1: { cellWidth: 22, halign: "center", fontSize: 7.5 },
      2: { cellWidth: 30, halign: "center" },
      3: { cellWidth: 30, halign: "center", fontSize: 7.5, textColor: [100, 116, 139] },
      4: { cellWidth: "auto", halign: "left" },
      5: { cellWidth: 32, halign: "right" },
      6: { cellWidth: 32, halign: "right" },
    },
    // Small top/bottom margins so the table fills the page and page 2+ starts near
    // the top — the old 40mm default bottom margin left a big empty band whenever a
    // row wrapped to the next page.
    margin: { top: 16, bottom: 12, left: margin, right: margin },
    // Recreate the web view's colored voucher-type badge, green/red debit-credit
    // amounts, and tinted Opening/Total/Closing rows — plain jsPDF grid otherwise
    // renders everything in flat black/white.
    didParseCell: (data: any) => {
      if (data.section !== "body") return;
      const voucherType = String(data.row.raw?.[2] ?? "");
      const isReceiptRow = voucherType === "Cash Receipt";
      const isPaymentRow = voucherType === "Cash Payment";
      const isOpening = voucherType === "Opening Balance";
      const isClosing = voucherType.startsWith("Closing Balance");
      const isTotal = voucherType === "Total";

      if (data.column.index === 2 && (isReceiptRow || isPaymentRow)) {
        // Don't let autoTable draw its own rectangular fill/text for this cell —
        // didDrawCell below paints a rounded pill badge on top instead, to match
        // the on-screen "rounded-full" badge exactly.
        data.cell.text = [];
      }
      if (data.column.index === 5 && data.cell.raw) {
        data.cell.styles.textColor = COLOR_GREEN_TEXT;
        data.cell.styles.fontStyle = "bold";
      }
      if (data.column.index === 6 && data.cell.raw) {
        data.cell.styles.textColor = COLOR_RED_TEXT;
        data.cell.styles.fontStyle = "bold";
      }
      if (isOpening || isClosing) {
        // Assign directly, not `?? existing` — with theme 'grid' autoTable pre-fills
        // every body cell with white (255), so the fallback guard never fired and the
        // Opening/Closing rows stayed white instead of the on-screen bg-amber-50 tint.
        data.cell.styles.fillColor = COLOR_AMBER_BG;
        data.cell.styles.fontStyle = "bold";
      } else if (isTotal) {
        data.cell.styles.fillColor = COLOR_GRAY_BG;
        data.cell.styles.fontStyle = "bold";
      }
    },
    // Draws the Voucher Type pill badge (rounded corners, tinted background,
    // centered bold text) on top of the cell that didParseCell left blank above —
    // matches the UI's "inline-block ... rounded-full px-2 py-0.5" badge shape,
    // which a plain rectangular cell fill can't reproduce.
    didDrawCell: (data: any) => {
      if (data.section !== "body" || data.column.index !== 2) return;
      const voucherType = String(data.row.raw?.[2] ?? "");
      const isReceiptRow = voucherType === "Cash Receipt";
      const isPaymentRow = voucherType === "Cash Payment";
      if (!isReceiptRow && !isPaymentRow) return;

      const bg = isReceiptRow ? COLOR_GREEN_BG : COLOR_RED_BG;
      const fg = isReceiptRow ? COLOR_GREEN_TEXT : COLOR_RED_TEXT;
      const { x, y, width, height } = data.cell;

      doc.setFont(reportFont, "bold");
      doc.setFontSize(7.5);
      const textWidth = doc.getTextWidth(voucherType);
      const paddingX = 2.5;
      const pillHeight = Math.min(height - 1, 5);
      const pillWidth = Math.min(width - 1.5, textWidth + paddingX * 2);
      const pillX = x + (width - pillWidth) / 2;
      const pillY = y + (height - pillHeight) / 2;

      doc.setFillColor(bg[0], bg[1], bg[2]);
      doc.roundedRect(pillX, pillY, pillWidth, pillHeight, pillHeight / 2, pillHeight / 2, "F");

      doc.setTextColor(fg[0], fg[1], fg[2]);
      doc.text(voucherType, x + width / 2, pillY + pillHeight / 2, { align: "center", baseline: "middle" });
    },
  });

  // ── EOD Cash Verification (denomination breakdown) ──
  if (denominationEntry) {
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    let sectionY = (doc as any).lastAutoTable.finalY + 12;
    if (sectionY > pageHeight - 60) {
      doc.addPage();
      sectionY = 20;
    }

    doc.setFontSize(9);
    doc.setFont(reportFont, "bold");
    doc.text("EOD CASH VERIFICATION", pageWidth / 2, sectionY, { align: "center" });

    const denomBody: any[] = [];
    DENOMINATION_UI_ROWS.forEach((denom) => {
      const count = (denominationEntry[denom.key as keyof DaybookDenominationEntry] as number) || 0;
      if (count === 0) return;
      denomBody.push([`${denom.label} x`, count.toLocaleString("en-IN"), fmtNum(count * denom.value)]);
    });
    if (denominationEntry.upi > 0) {
      denomBody.push(["UPI / Digital x 1", denominationEntry.upi.toLocaleString("en-IN"), fmtNum(denominationEntry.upi)]);
    }
    const denomTotal = calcDenomTotal(denominationEntry);
    const denomDiff = denomTotal - fullCb;
    denomBody.push(["Total", "", fmtNum(denomTotal)]);
    denomBody.push(["System Balance", "", fmtNum(fullCb)]);
    denomBody.push(["Difference", "", fmtNum(denomDiff)]);

    // Narrow, centered table — mirrors the web view's "max-w-sm mx-auto" box,
    // with the same light-gray header / black borders as EOD Cash Verification there.
    const denomTableWidth = 60 + 30 + 40;
    const denomMargin = Math.max(margin, (pageWidth - denomTableWidth) / 2);

    autoTable(doc, {
      startY: sectionY + 3,
      head: [["Denomination", "Count", "Amount Rs."]],
      body: denomBody,
      theme: "grid",
      headStyles: { font: reportFont, fillColor: COLOR_GRAY_BG, textColor: [0, 0, 0], fontStyle: "bold", fontSize: 8, halign: "center", lineColor: [0, 0, 0], lineWidth: 0.1 },
      styles: { font: reportFont, fontSize: 7, cellPadding: 2, lineColor: [0, 0, 0], lineWidth: 0.1 },
      columnStyles: {
        0: { cellWidth: 60, halign: "left" },
        1: { cellWidth: 30, halign: "right" },
        2: { cellWidth: 40, halign: "right" },
      },
      margin: { left: denomMargin, right: denomMargin },
      didParseCell: (data: any) => {
        if (data.section !== "body") return;
        const label = String(data.row.raw?.[0] ?? "");
        if (label === "Total") {
          data.cell.styles.fillColor = COLOR_GRAY_BG;
          data.cell.styles.fontStyle = "bold";
        } else if (label === "Difference") {
          const isMatch = Math.abs(denomDiff) < 0.01;
          data.cell.styles.fillColor = isMatch ? COLOR_GREEN_BG : COLOR_RED_BG;
          data.cell.styles.textColor = isMatch ? COLOR_GREEN_TEXT : COLOR_RED_TEXT;
          data.cell.styles.fontStyle = "bold";
        }
      },
    });

    if (denominationEntry.remarks) {
      const afterDenomY = (doc as any).lastAutoTable.finalY + 6;
      doc.setFontSize(8);
      doc.setFont(reportFont, "normal");
      doc.text(`Remarks: ${denominationEntry.remarks}`, margin, afterDenomY);
    }
  }
}
