import { jsPDF } from "jspdf";
import { format, parseISO } from "date-fns";
import { getAttendanceDetailedRows } from "@/app/lib/reports/queries/batch1";
import { drawAttendanceDetailedReport } from "@/app/lib/reports/attendance-detailed-pdf";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

/**
 * Request Report / Request Queue PDF renderer for "attendance-detailed" —
 * reuses the exact same drawAttendanceDetailedReport() the Direct Download
 * PDF uses (app/lib/reports/attendance-detailed-pdf.ts), just with Node-safe
 * logo/font loading injected instead of the browser-only defaults.
 *
 * Reuses getAttendanceDetailedRows() from
 * app/lib/reports/queries/batch1.ts — the exact same function both the live
 * GET route and report-registry.ts's fetchAttendanceDetailed already call —
 * so no query or figure is recalculated for PDF. Rows are formatted here the
 * same way Direct's own buildAttendanceExportRows() does (date-fns
 * dd/MM/yyyy and HH:mm:ss), not report-registry.ts's differently-formatted
 * toLocaleDateString rows, to match the Direct PDF exactly.
 */
export async function buildAttendanceDetailedQueuePdf(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate || !ctx.toDate) {
    throw new Error("fromDate and toDate are required for the Attendance Detailed report");
  }

  const filteredData = await getAttendanceDetailedRows({
    fromDate: ctx.fromDate,
    toDate: ctx.toDate,
    branchIds: ctx.branchIds,
  });

  const headers = ["Date", "Branch", "Employee", "Status", "Check-In", "Check-Out"];
  const rows: (string | number)[][] = filteredData.map((item) => [
    format(parseISO(item.attendanceDate), "dd/MM/yyyy"),
    item.branchName,
    item.employeeName,
    item.attendance,
    item.checkIn ? format(parseISO(item.checkIn), "HH:mm:ss") : "N/A",
    item.checkOut ? format(parseISO(item.checkOut), "HH:mm:ss") : "N/A",
  ]);
  if (filteredData.length > 0) {
    const present = filteredData.filter((d) => d.attendance === "PRESENT").length;
    const absent = filteredData.filter((d) => d.attendance === "ABSENT").length;
    const halfDay = filteredData.filter((d) => d.attendance === "HALF_DAY").length;
    rows.push([
      "Grand Total:", `${filteredData.length} Records`, `Present: ${present}, Absent: ${absent}, Half Day: ${halfDay}`, "", "", "",
    ]);
  }

  const doc = new jsPDF({ orientation: "landscape" });
  const reportFont = ensureReportFontServer(doc);

  await drawAttendanceDetailedReport(
    doc,
    { headers, rows },
    { subtitle: `${ctx.fromDate} to ${ctx.toDate}` },
    reportFont,
    drawPdfReportHeaderServer
  );

  return Buffer.from(doc.output("arraybuffer"));
}
