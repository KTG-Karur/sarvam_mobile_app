import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { getDocBrandPrimaryRgb } from "@/app/lib/reports/pdf-brand-color";
import { drawPdfReportHeader } from "@/app/lib/reports/pdf-report-header";
import { normalizeMeetingTime } from "@/app/lib/utils/meeting-time";
import { truncateReportAmount } from "@/app/lib/utils/format-amount";

/** Signature shared with the other migrated reports' PdfHeaderDrawer — lets a server caller
 * (no window/DOM) inject its own Node-safe logo/font loading in place of the browser-only
 * drawPdfReportHeader default. */
export type PdfHeaderDrawer = (
  doc: jsPDF,
  title: string,
  opts?: { subtitle?: string; fontFamily?: string }
) => Promise<number>;

export interface MeetingCheckRow {
  centerCode: string;
  centerName: string;
  fdoName: string;
  meetingTime: string;
  clientCount: number;
  meetingStatus: string;
  expectedCollection: number;
  actualCollection: number;
  collectionVariance: number;
}

/**
 * Draws the Daily Meeting Report — trust header, then a single flat
 * A4-landscape table (no header grouping — grouping exists only in the
 * separate Word export path — and no totals row) — extracted verbatim from
 * the Direct Download PDF logic in components/reports/MeetingCheckClient.tsx's
 * handleExportPDF / buildMeetingCheckExportRows, so the exact same
 * rendering can be reused by the Request Report queue's PDF builder (via an
 * injected Node-safe `drawHeader`) without duplicating the table logic.
 * `drawHeader` defaults to the browser drawPdfReportHeader, so the existing
 * Direct caller is unaffected by this extraction.
 */
export async function drawMeetingCheckReport(
  doc: jsPDF,
  searchedRows: MeetingCheckRow[],
  meta: { subtitle: string },
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const headers = ["Center Code", "Center Name", "FDO Name", "Meeting Time", "Clients", "Status", "Expected Collection", "Actual Collection", "Variance"];
  const rows: (string | number)[][] = searchedRows.map((row) => [
    row.centerCode, row.centerName, row.fdoName, row.meetingTime ? normalizeMeetingTime(row.meetingTime) : "",
    row.clientCount, row.meetingStatus, truncateReportAmount(row.expectedCollection), truncateReportAmount(row.actualCollection), truncateReportAmount(row.collectionVariance),
  ]);

  const headerY = await drawHeader(doc, "DAILY MEETING REPORT", { subtitle: meta.subtitle, fontFamily: reportFont });

  autoTable(doc, {
    startY: headerY,
    head: [headers],
    body: rows,
    styles: { fontSize: 7, font: reportFont },
    headStyles: { fillColor: getDocBrandPrimaryRgb(doc), textColor: 255, fontStyle: "bold", font: reportFont },
  });
}
