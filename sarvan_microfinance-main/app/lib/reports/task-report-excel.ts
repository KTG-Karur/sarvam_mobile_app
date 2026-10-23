import * as XLSX from "xlsx-js-style";
import { computeTaskReport } from "@/app/api/reports/employee/task-report/route";
import { getActiveBrandNames } from "@/app/lib/brand-server";
import { buildReportSheet, autoSizeColumns, applyExcelReportFont } from "@/app/lib/reports/excel-report-header";
import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";

/**
 * Mirrors components/reports/TaskReportClient.tsx's module-level rowToExcelObj() exactly —
 * same 28 keyed columns, same order (also independently duplicated as taskRowToObj() in
 * report-registry.ts's fetchTaskReport, for that report's flattened PDF/CSV/Word "Level"-column
 * shape — a different shape from this one, so not reused directly).
 */
function rowToExcelObj(r: Record<string, any>) {
  return {
    "Employee ID": r.employeeId || "",
    "Name": r.name,
    "Branch": r.branch,
    "Enr. Target": r.enrollmentTarget,
    "New Member Target": r.newMemberTarget,
    "Renewal Target": r.renewalTarget,
    "Disbmt Target (₹)": r.loanDisbursementTarget,
    "Enr. Achieved": r.enrollmentAchieved,
    "Enr. Balance": r.enrollmentBalance,
    "New Member Achieved": r.newMemberAchieved,
    "Renewal Achieved": r.renewalAchieved,
    "Disbmt Achieved (₹)": r.loanDisbursementAchieved,
    "Coll. Target %": r.collectionTargetPct,
    "Actual Coll. %": r.actualCollectionPct,
    "Coll. Diff %": r.collectionDifferencePct,
    "No. Centers": r.numberOfCenters,
    "Active (Total)": r.activeClients,
    "Active Members": r.activeMembers,
    "Active Clients": r.activeClientsWithLoan,
    "Disbmt Members": r.totalDisbursementMembers,
    "Gold Loan Members": r.goldLoanMembers,
    "Gold Loan Amount (₹)": r.goldLoanAmount,
    "Gold Returns": r.goldReturn,
    "Portfolio Principal (₹)": r.portfolioPrincipal,
    "Portfolio Interest (₹)": r.portfolioInterest,
    "Arrear Clients": r.arrearClients,
    "Arrear Principal (₹)": r.arrearPrincipal,
    "Arrear Interest (₹)": r.arrearInterest,
    "Arrear Member %": r.arrearMemberPct,
  };
}

/**
 * Request Report / Request Queue Excel renderer for "task-report" — reproduces Direct
 * Download's own handleExportExcel() workbook structure exactly: up to 5 sheets (FDO, Branch
 * Manager, Area Manager, Division Manager — each only when that group is non-empty, matching
 * Direct's own `if (data.X.length > 0)` guards — plus Summary, always present), same sheet
 * names/order, same per-sheet trust-name/title header block (via the same shared
 * buildReportSheet() helper Direct itself uses), same columns.
 *
 * Reuses computeTaskReport() (app/api/reports/employee/task-report/route.ts) — the exact same
 * function both the live API route and report-registry.ts's fetchTaskReport already call — so
 * no query or figure is recalculated for Excel.
 */
export async function buildTaskReportQueueExcel(ctx: BuildReportFileContext): Promise<Buffer> {
  const month = ctx.filters?.month ? parseInt(ctx.filters.month, 10) : NaN;
  const year = ctx.filters?.year ? parseInt(ctx.filters.year, 10) : NaN;
  if (isNaN(month) || month < 1 || month > 12 || isNaN(year)) {
    throw new Error("filters.month (1-12) and filters.year are required for the FDO Task Report");
  }
  // Mirrors fetchTaskReport's own branch-scoping comment: computeTaskReport only accepts a
  // single branchId — ctx.branchIds is already permission-scoped by the caller, so a
  // restricted (non-admin) requester always has at least one entry.
  const branchId = ctx.filters?.branchId ?? ctx.branchIds?.[0] ?? null;
  const data = await computeTaskReport(month, year, branchId, null);

  const { companyNameFull } = await getActiveBrandNames();
  const wb = XLSX.utils.book_new();

  const groups: [typeof data.fdo, string, string][] = [
    [data.fdo, "FDO Task Report - FDO", "FDO"],
    [data.bm, "FDO Task Report - Branch Manager", "Branch Manager"],
    [data.am, "FDO Task Report - Area Manager", "Area Manager"],
    [data.dm, "FDO Task Report - Division Manager", "Division Manager"],
  ];
  for (const [rows, title, sheetName] of groups) {
    if (rows.length === 0) continue;
    const ws = buildReportSheet(title, rows.map(rowToExcelObj), companyNameFull);
    autoSizeColumns(ws);
    applyExcelReportFont(ws);
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  }

  const wsSummary = buildReportSheet("FDO Task Report - Summary", [rowToExcelObj(data.totals)], companyNameFull);
  autoSizeColumns(wsSummary);
  applyExcelReportFont(wsSummary);
  XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
