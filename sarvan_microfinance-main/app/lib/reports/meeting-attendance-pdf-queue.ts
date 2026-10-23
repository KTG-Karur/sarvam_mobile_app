import { jsPDF } from "jspdf";
import { getReportEntry } from "@/app/lib/reports/report-registry";
import { drawMeetingAttendanceReport } from "@/app/lib/reports/meeting-attendance-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

const STATUS_COLUMN = 6;

/**
 * Request Report / Request Queue PDF renderer for "meeting-attendance" —
 * reuses the exact same drawMeetingAttendanceReport() the Direct Download
 * PDF uses (app/lib/reports/meeting-attendance-pdf.ts), just with
 * Node-safe logo/font loading injected instead of the browser-only
 * defaults.
 *
 * Reuses the report registry's own fetchMeetingAttendance() (via
 * getReportEntry) — the exact same shared query helpers
 * (buildMeetingAttendanceWhere/meetingAttendanceInclude/
 * mapMeetingAttendanceRecord) the live route uses, producing the exact
 * same 8 columns/order as Direct's own buildMeetingAttendanceExportRows().
 * fetchMeetingAttendance's ReportRows has no trailing Grand Total row (the
 * live route computes Present/Absent counts via a separate summary query
 * this fetch doesn't call), so the counts are recomputed here by filtering
 * the already-fetched rows' Status column — never via a new query —
 * mirroring the same client-side fallback Direct itself uses when its own
 * summary state is unavailable.
 */
export async function buildMeetingAttendanceQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate || !ctx.toDate) {
    throw new Error("fromDate and toDate are required for the Meeting Attendance report");
  }

  const entry = getReportEntry("meeting-attendance");
  if (!entry?.fetch) {
    throw new Error("Meeting Attendance report is not registered");
  }
  const { headers, rows } = await entry.fetch({
    fromDate: ctx.fromDate,
    toDate: ctx.toDate,
    branchIds: ctx.branchIds,
    filters: ctx.filters,
  });

  const body = rows.slice();
  if (rows.length > 0) {
    const presentCount = rows.filter((r) => r[STATUS_COLUMN] === "Present").length;
    const absentCount = rows.filter((r) => r[STATUS_COLUMN] === "Absent").length;
    body.push(["Grand Total:", `${rows.length} Records`, `Present: ${presentCount}, Absent: ${absentCount}`, "", "", "", "", ""]);
  }

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const reportFont = ensureReportFontServer(doc);

  await drawMeetingAttendanceReport(doc, headers, body, { subtitle: `${ctx.fromDate} to ${ctx.toDate}` }, reportFont, drawPdfReportHeaderServer);

  return Buffer.from(doc.output("arraybuffer"));
}
