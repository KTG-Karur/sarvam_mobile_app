import * as XLSX from "xlsx-js-style";
import { getIncentiveReportData, type IncentiveReportRow } from "@/app/lib/services/incentive-report.service";
import { getActiveBrandNames } from "@/app/lib/brand-server";
import { reportHeaderRows, autoSizeColumns, applyExcelReportFont } from "@/app/lib/reports/excel-report-header";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

// Mirrors components/reports/IncentiveReportClient.tsx's module-level COLUMNS/COLUMN_GROUPS/
// HEADER_GROUP_RUNS exactly (also independently duplicated in app/lib/reports/incentive-report-pdf.ts
// for the same reason — a 'use client' component can't be imported server-side, and this file
// doesn't import from the PDF file either, so as not to touch/depend on PDF code for an
// Excel-only batch). PDF_GROUP_FILL is intentionally NOT duplicated here — Direct's own Excel
// handler notes the free `xlsx` build can't apply cell fill colors, so the grouped row carries
// only labels/merges, no color banding (matching Direct's Excel exactly, not its PDF).

type GroupId = "officer" | "active" | "gold" | "jlg" | "collection" | "od" | "final";

const COLUMN_GROUPS: Record<GroupId, { label: string }> = {
  officer: { label: "FIELD OFFICER" },
  active: { label: "ACTIVE MEMBERS" },
  gold: { label: "GOLD LOAN" },
  jlg: { label: "JLG LOAN" },
  collection: { label: "COLLECTION INCENTIVE" },
  od: { label: "OD COLLECTION" },
  final: { label: "FINAL WORKINGS" },
};

const fmtAmt = (n: number) => new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n ?? 0);
const fmtDate = (d: string | null) => {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};

type ColDef = { header: string; group: GroupId; render: (r: IncentiveReportRow) => string | number };

const COLUMNS: ColDef[] = [
  { header: "Division", group: "officer", render: (r) => r.division || "—" },
  { header: "Branch", group: "officer", render: (r) => r.branch || "—" },
  { header: "DOJ", group: "officer", render: (r) => fmtDate(r.dateOfJoining) },
  { header: "Emp ID", group: "officer", render: (r) => r.employeeId ?? "—" },
  { header: "Staff Name", group: "officer", render: (r) => r.staffName },
  { header: "Category", group: "officer", render: (r) => r.fieldOfficerCategory ?? "—" },

  { header: "Active Clients", group: "active", render: (r) => r.activeClients },

  { header: "Gold Target", group: "gold", render: (r) => r.goldLoanTarget },
  { header: "Gold Achieved", group: "gold", render: (r) => r.goldLoanAchievedMembers },
  { header: "Gold Disb. Amt", group: "gold", render: (r) => fmtAmt(r.goldLoanDisbursementAmount) },
  { header: "Achv %", group: "gold", render: (r) => `${r.achievementPercent}%` },
  { header: "Eligible Incentive", group: "gold", render: (r) => fmtAmt(r.eligibleIncentive) },
  { header: "Wt 0.500-0.640", group: "gold", render: (r) => fmtAmt(r.goldWeightSlab1) },
  { header: "Wt 0.990-1.030", group: "gold", render: (r) => fmtAmt(r.goldWeightSlab2) },
  { header: "Wt 1.050-2.020", group: "gold", render: (r) => fmtAmt(r.goldWeightSlab3) },
  { header: "Weight Incentive", group: "gold", render: (r) => fmtAmt(r.goldWeightIncentive) },

  { header: "JLG Members", group: "jlg", render: (r) => r.jlgLoanMembers },
  { header: "JLG Disb. Amt", group: "jlg", render: (r) => fmtAmt(r.jlgLoanDisbursement) },
  { header: "IGP Incentive", group: "jlg", render: (r) => fmtAmt(r.jlgIncentive) },

  { header: "Total Demand", group: "collection", render: (r) => fmtAmt(r.totalDemand) },
  { header: "Demand Coll.", group: "collection", render: (r) => fmtAmt(r.demandCollection) },
  { header: "Arrear Coll.", group: "collection", render: (r) => fmtAmt(r.arrearCollection) },
  { header: "Total Coll.", group: "collection", render: (r) => fmtAmt(r.totalCollection) },
  { header: "Recovery %", group: "collection", render: (r) => `${r.recoveryPercent}%` },
  { header: "Collection Incentive", group: "collection", render: (r) => fmtAmt(r.collectionIncentive) },

  { header: "OD 31-60", group: "od", render: (r) => fmtAmt(r.odCollection31to60) },
  { header: "OD 61-90", group: "od", render: (r) => fmtAmt(r.odCollection61to90) },
  { header: "OD 91-180", group: "od", render: (r) => fmtAmt(r.odCollection91to180) },
  { header: "OD >180", group: "od", render: (r) => fmtAmt(r.odCollectionAbove180) },
  { header: "OD Incentive", group: "od", render: (r) => fmtAmt(r.odCollectionIncentive) },

  { header: "Final Incentive", group: "final", render: (r) => fmtAmt(r.finalIncentive) },
];

// Consecutive-run header groups, in column order (for the banded group-label row).
const HEADER_GROUP_RUNS: { group: GroupId; span: number }[] = (() => {
  const runs: { group: GroupId; span: number }[] = [];
  for (const col of COLUMNS) {
    const last = runs[runs.length - 1];
    if (last && last.group === col.group) last.span++;
    else runs.push({ group: col.group, span: 1 });
  }
  return runs;
})();

/**
 * Request Report / Request Queue Excel renderer for "incentive-report" — reproduces Direct
 * Download's own handleExportExcel() workbook exactly: 3 title rows (trust name/title/blank),
 * a banded group-label row with merged cells per section (ACTIVE MEMBERS / GOLD LOAN / JLG
 * LOAN / COLLECTION INCENTIVE / OD COLLECTION / FINAL WORKINGS), a column-header row, then
 * data rows — same column order/labels/render formatting, same single sheet name.
 *
 * Reuses getIncentiveReportData() (app/lib/services/incentive-report.service.ts) — the exact
 * same function the live GET route, report-registry.ts's fetchIncentiveReport, and this
 * report's own PDF queue builder already call — so no query or figure is recalculated.
 */
export async function buildIncentiveReportQueueExcel(ctx: BuildReportFileContext): Promise<Buffer> {
  if (!ctx.fromDate || !ctx.toDate) {
    throw new Error("fromDate and toDate are required for the Incentive Report");
  }

  const result = await getIncentiveReportData({
    fromDate: ctx.fromDate,
    toDate: ctx.toDate,
    scopedBranchIds: ctx.branchIds,
    branchId: ctx.filters?.branchId,
    divisionId: ctx.filters?.divisionId,
    fdoId: ctx.filters?.fdoId,
    search: ctx.filters?.search,
    exportAll: true,
  });
  const allData: IncentiveReportRow[] = result.data;

  const groupRow: string[] = [];
  let colCursor = 0;
  const merges: XLSX.Range[] = [];
  for (const run of HEADER_GROUP_RUNS) {
    groupRow[colCursor] = COLUMN_GROUPS[run.group].label;
    for (let i = 1; i < run.span; i++) groupRow[colCursor + i] = "";
    if (run.span > 1) {
      merges.push({ s: { r: 3, c: colCursor }, e: { r: 3, c: colCursor + run.span - 1 } });
    }
    colCursor += run.span;
  }

  const { companyNameFull } = await getActiveBrandNames();
  const titleRows = reportHeaderRows("Incentive Report", companyNameFull);
  const columnHeaderRow = COLUMNS.map((c) => c.header);
  const dataRows = allData.map((r) => COLUMNS.map((c) => c.render(r)));

  const ws = XLSX.utils.aoa_to_sheet([...titleRows, groupRow, columnHeaderRow, ...dataRows]);
  ws["!merges"] = merges;
  autoSizeColumns(ws);
  applyExcelReportFont(ws);

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Incentive Report");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
