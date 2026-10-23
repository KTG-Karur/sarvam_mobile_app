import { jsPDF } from "jspdf";
import { format } from "date-fns";
import { prisma } from "@/app/lib/prisma";
import {
  getDemandSheetDataForQueue,
  getDemandSheetClientWiseTableDataForQueue,
  getDemandSheetClientWiseCenterReportForQueue,
  type DemandClientWiseReportData,
} from "@/app/lib/actions/demand";
import { drawDemandSheetCenterwisePage } from "@/app/lib/reports/demand-sheet-centerwise-pdf";
import { drawClientWiseCenterReportPage } from "@/app/lib/reports/client-wise-center-report";
import { drawPdfReportHeaderServer } from "@/app/lib/reports/pdf-report-header-server";
import { ensureReportFontServer } from "@/app/lib/reports/pdf-fonts-server";
import { getLoanAdvanceEnabled } from "@/app/lib/loan-advance-config";

/**
 * Request Report / Request Queue PDF renderer for the "demand-sheet" report —
 * reuses the exact same per-report rendering functions the Direct Download PDF
 * uses (drawDemandSheetCenterwisePage / drawClientWiseCenterReportPage, both in
 * lib files this feature already introduced for reuse), just with Node-safe
 * logo/font loading (drawPdfReportHeaderServer / ensureReportFontServer)
 * injected instead of the browser-only defaults — so the queued PDF is
 * structurally and visually the same report, not a separately-designed one.
 *
 * Independently re-fetches the same underlying Demand Sheet data via the
 * existing *ForQueue server actions (no new query types) rather than reusing
 * the generic flat {headers, rows} the Excel/CSV/Word queue exports use for
 * this report — those formats and their data shape are untouched.
 */
export interface DemandSheetQueuePdfParams {
  fromDate: string;
  fdoId: string;
  reportType: "centerwise" | "clientwise";
  /** Present only when a specific center's Detailed Report was requested; absent = all centers. */
  centerId?: string;
  branchIds: string[] | null;
  branchLabel: string;
}

async function resolveFdoNameForQueue(fdoId: string): Promise<string> {
  if (!fdoId || fdoId === "all") return "ALL";
  const fdoUser = await prisma.user.findUnique({
    where: { id: fdoId },
    select: { firstName: true, lastName: true },
  });
  if (!fdoUser) return "-";
  return [fdoUser.firstName, fdoUser.lastName].filter(Boolean).join(" ").trim();
}

export async function buildDemandSheetQueuePdf(params: DemandSheetQueuePdfParams): Promise<Buffer> {
  const { fromDate, fdoId, reportType, centerId, branchIds, branchLabel } = params;

  const doc = new jsPDF({
    orientation: "landscape",
    unit: "mm",
    format: "a4",
    compress: true,
  });
  const reportFont = ensureReportFontServer(doc);
  const loanAdvanceEnabled = await getLoanAdvanceEnabled();

  if (reportType === "centerwise") {
    const rows = await getDemandSheetDataForQueue(fromDate, fdoId, branchIds);
    if (rows.length === 0) {
      throw new Error("No demand sheet data found for the selected criteria.");
    }
    const [fdoName] = await Promise.all([resolveFdoNameForQueue(fdoId)]);
    const parsedDate = new Date(`${fromDate}T00:00:00`);
    const dayName = format(parsedDate, "EEEE").toUpperCase();
    const formattedDate = format(parsedDate, "dd/MM/yyyy");

    await drawDemandSheetCenterwisePage(
      doc,
      rows,
      { branchLabel, fdoName, dayName, formattedDate },
      reportFont,
      drawPdfReportHeaderServer,
      loanAdvanceEnabled
    );
    return Buffer.from(doc.output("arraybuffer"));
  }

  // Clientwise — always the rich per-center "Detailed report" structure (table +
  // grand totals + denomination + signatures), never the flat summary table:
  // one report when a specific center was requested, one PER CENTER (repeated,
  // each with its own denomination section) otherwise.
  let reports: DemandClientWiseReportData[];
  if (centerId) {
    reports = [await getDemandSheetClientWiseCenterReportForQueue(fromDate, fdoId, centerId, branchIds)];
  } else {
    const clientRows = await getDemandSheetClientWiseTableDataForQueue(fromDate, fdoId, branchIds);
    const byId = new Map<string, string>();
    for (const row of clientRows) {
      if (!byId.has(row.centerId)) byId.set(row.centerId, row.centerName);
    }
    const centers = [...byId.entries()].sort((a, b) =>
      a[1].localeCompare(b[1], undefined, { sensitivity: "base" })
    );
    reports = await Promise.all(
      centers.map(([cid]) => getDemandSheetClientWiseCenterReportForQueue(fromDate, fdoId, cid, branchIds))
    );
  }

  if (reports.length === 0) {
    throw new Error("No demand sheet data found for the selected criteria.");
  }

  for (let i = 0; i < reports.length; i++) {
    if (i > 0) doc.addPage();
    await drawClientWiseCenterReportPage(doc, reports[i], fromDate, reportFont, drawPdfReportHeaderServer, loanAdvanceEnabled);
  }
  return Buffer.from(doc.output("arraybuffer"));
}
