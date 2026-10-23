import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { getDocBrandPrimaryRgb, getDocBrandTintRgb } from "@/app/lib/reports/pdf-brand-color";
import { drawPdfReportHeader } from "@/app/lib/reports/pdf-report-header";

/** Signature shared with the other migrated reports' PdfHeaderDrawer — lets a server caller
 * (no window/DOM) inject its own Node-safe logo/font loading in place of the browser-only
 * drawPdfReportHeader default. */
export type PdfHeaderDrawer = (
  doc: jsPDF,
  title: string,
  opts?: { subtitle?: string; fontFamily?: string }
) => Promise<number>;

/**
 * Draws the Meeting Attendance report — trust header, then a single flat
 * A4-landscape table (no header grouping) with a trailing "Grand Total:"
 * row (record count + Present/Absent breakdown, not a numeric sum) —
 * extracted verbatim from the Direct Download PDF logic in
 * components/reports/MeetingAttendanceClient.tsx's handleExportPDF /
 * buildMeetingAttendanceExportRows, so the exact same rendering can be
 * reused by the Request Report queue's PDF builder (via an injected
 * Node-safe `drawHeader`) without duplicating the table logic.
 * `drawHeader` defaults to the browser drawPdfReportHeader, so the
 * existing Direct caller is unaffected by this extraction.
 */
export async function drawMeetingAttendanceReport(
  doc: jsPDF,
  headers: string[],
  rows: (string | number)[][],
  meta: { subtitle: string },
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const headerY = await drawHeader(doc, "MEETING ATTENDANCE REPORT", { subtitle: meta.subtitle, fontFamily: reportFont });

  autoTable(doc, {
    startY: headerY,
    head: [headers],
    body: rows,
    styles: { font: reportFont, fontSize: 7, cellPadding: 1.5 },
    headStyles: { font: reportFont, fillColor: getDocBrandPrimaryRgb(doc), textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: getDocBrandTintRgb(doc) },
  });
}
