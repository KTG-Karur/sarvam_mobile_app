import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { getDocBrandPrimaryRgb, getDocBrandTintRgb } from "@/app/lib/reports/pdf-brand-color";
import { drawPdfReportHeader } from "@/app/lib/reports/pdf-report-header";
import type { DCRRow, DCRFunderMeta } from "@/app/lib/actions/reports";
import { truncateReportAmount } from "@/app/lib/utils/format-amount";

/** Signature shared with the other migrated reports' PdfHeaderDrawer — lets a server caller
 * (no window/DOM) inject its own Node-safe logo/font loading in place of the browser-only
 * drawPdfReportHeader default. */
export type PdfHeaderDrawer = (
  doc: jsPDF,
  title: string,
  opts?: { subtitle?: string; fontFamily?: string }
) => Promise<number>;

function zeroBreakdown() {
  return {
    principal: 0, interest: 0, preclosurePrincipal: 0, preclosureInterest: 0,
    writeOffCashPrincipal: 0, writeOffCashInterest: 0, writeOffGoldPrincipal: 0, writeOffGoldInterest: 0,
    totalPrincipal: 0, totalInterest: 0,
  };
}

type DCRFunderField = "principal" | "interest" | "preclosurePrincipal" | "preclosureInterest"
  | "writeOffCashPrincipal" | "writeOffCashInterest" | "writeOffGoldPrincipal" | "writeOffGoldInterest"
  | "totalPrincipal" | "totalInterest";

/**
 * Draws the Daily Collection Report (DCR) — trust header, then a single
 * flat A3-landscape table (dynamic per-funder columns, no header grouping —
 * the PDF path is flat; grouping exists only in the separate Word export
 * path) with a trailing Grand Total row — extracted verbatim from the
 * Direct Download PDF logic in components/reports/DCRClient.tsx's
 * handleExportPDF / buildDCRExportRows, so the exact same rendering can be
 * reused by the Request Report queue's PDF builder (via an injected
 * Node-safe `drawHeader`) without duplicating the table logic. `drawHeader`
 * defaults to the browser drawPdfReportHeader, so the existing Direct
 * caller is unaffected by this extraction.
 */
export async function drawDcrReport(
  doc: jsPDF,
  searchedRows: DCRRow[],
  funders: DCRFunderMeta[],
  meta: { subtitle: string },
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader,
  loanAdvanceEnabled: boolean = true
): Promise<void> {
  const sum = (key: keyof DCRRow, source: DCRRow[]) => source.reduce((s, r) => s + (r[key] as number), 0);
  const sumFunderField = (funderId: string, field: DCRFunderField, source: DCRRow[]) =>
    source.reduce((s, r) => s + (r.funderBreakdown[funderId]?.[field] ?? 0), 0);
  const overallPrincipal = (row: DCRRow) => Object.values(row.funderBreakdown).reduce((s, b) => s + b.totalPrincipal, 0);
  const overallInterest = (row: DCRRow) => Object.values(row.funderBreakdown).reduce((s, b) => s + b.totalInterest, 0);
  const overallGoldPrincipal = (row: DCRRow) => Object.values(row.funderBreakdown).reduce((s, b) => s + b.writeOffGoldPrincipal, 0);
  const overallGoldInterest = (row: DCRRow) => Object.values(row.funderBreakdown).reduce((s, b) => s + b.writeOffGoldInterest, 0);

  const headers = [
    "Center ID", "Center Name",
    "Admin Fees", "Doc. Charges", "Ins. Fees",
    ...funders.flatMap((f) => [`${f.name} - Principal`, `${f.name} - Interest`, `${f.name} - Gold Principal`, `${f.name} - Gold Interest`]),
    "Total Principal", "Total Interest", "Total Gold Principal", "Total Gold Interest",
    ...(loanAdvanceEnabled ? ["Loan Advance"] : []), "Total Amount",
  ];
  const rows: (string | number)[][] = searchedRows.map((r) => [
    r.centerCode, r.centerName,
    truncateReportAmount(r.adminFees), truncateReportAmount(r.docCharges), truncateReportAmount(r.insFees),
    ...funders.flatMap((f) => {
      const b = r.funderBreakdown[f.id] ?? zeroBreakdown();
      return [truncateReportAmount(b.totalPrincipal), truncateReportAmount(b.totalInterest), truncateReportAmount(b.writeOffGoldPrincipal), truncateReportAmount(b.writeOffGoldInterest)];
    }),
    truncateReportAmount(overallPrincipal(r)), truncateReportAmount(overallInterest(r)), truncateReportAmount(overallGoldPrincipal(r)), truncateReportAmount(overallGoldInterest(r)),
    ...(loanAdvanceEnabled ? [truncateReportAmount(r.savings)] : []), truncateReportAmount(r.totalAmount),
  ]);
  if (searchedRows.length > 0) {
    const filteredGrandOverallPrincipal = funders.reduce((s, f) => s + sumFunderField(f.id, "totalPrincipal", searchedRows), 0);
    const filteredGrandOverallInterest = funders.reduce((s, f) => s + sumFunderField(f.id, "totalInterest", searchedRows), 0);
    const filteredGrandOverallGoldPrincipal = funders.reduce((s, f) => s + sumFunderField(f.id, "writeOffGoldPrincipal", searchedRows), 0);
    const filteredGrandOverallGoldInterest = funders.reduce((s, f) => s + sumFunderField(f.id, "writeOffGoldInterest", searchedRows), 0);
    rows.push([
      "Grand Total", "",
      truncateReportAmount(sum("adminFees", searchedRows)), truncateReportAmount(sum("docCharges", searchedRows)), truncateReportAmount(sum("insFees", searchedRows)),
      ...funders.flatMap((f) => [
        truncateReportAmount(sumFunderField(f.id, "totalPrincipal", searchedRows)), truncateReportAmount(sumFunderField(f.id, "totalInterest", searchedRows)),
        truncateReportAmount(sumFunderField(f.id, "writeOffGoldPrincipal", searchedRows)), truncateReportAmount(sumFunderField(f.id, "writeOffGoldInterest", searchedRows)),
      ]),
      truncateReportAmount(filteredGrandOverallPrincipal), truncateReportAmount(filteredGrandOverallInterest), truncateReportAmount(filteredGrandOverallGoldPrincipal), truncateReportAmount(filteredGrandOverallGoldInterest),
      ...(loanAdvanceEnabled ? [truncateReportAmount(sum("savings", searchedRows))] : []), truncateReportAmount(sum("totalAmount", searchedRows)),
    ]);
  }

  const headerY = await drawHeader(doc, "DAILY COLLECTION REPORT", {
    subtitle: meta.subtitle,
    fontFamily: reportFont,
  });

  autoTable(doc, {
    startY: headerY,
    head: [headers],
    body: rows,
    styles: { fontSize: 7, cellPadding: 1.5, font: reportFont },
    headStyles: { fillColor: getDocBrandPrimaryRgb(doc), textColor: 255, fontStyle: "bold", font: reportFont },
    alternateRowStyles: { fillColor: getDocBrandTintRgb(doc) },
  });
}
