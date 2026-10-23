import type { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { drawPdfReportHeader } from "@/app/lib/reports/pdf-report-header";
import { formatReportAmount } from "@/app/lib/utils/format-amount";

/** Signature shared with the other migrated reports' PdfHeaderDrawer — lets a server caller
 * (no window/DOM) inject its own Node-safe logo/font loading in place of the browser-only
 * drawPdfReportHeader default. */
export type PdfHeaderDrawer = (
  doc: jsPDF,
  title: string,
  opts?: { subtitle?: string; fontFamily?: string }
) => Promise<number>;

export interface IncentiveReportRow {
  fdoId: string;
  division: string;
  branch: string;
  dateOfJoining: string | null;
  employeeId: string | null;
  staffName: string;
  fieldOfficerCategory: string | null;
  activeClients: number;
  goldLoanTarget: number;
  goldLoanAchievedMembers: number;
  goldLoanDisbursementAmount: number;
  achievementPercent: number;
  eligibleIncentive: number;
  goldWeightSlab1: number;
  goldWeightSlab2: number;
  goldWeightSlab3: number;
  goldWeightIncentive: number;
  jlgLoanMembers: number;
  jlgLoanDisbursement: number;
  jlgIncentive: number;
  totalDemand: number;
  demandCollection: number;
  arrearCollection: number;
  totalCollection: number;
  recoveryPercent: number;
  collectionIncentive: number;
  odCollection31to60: number;
  odCollection61to90: number;
  odCollection91to180: number;
  odCollectionAbove180: number;
  odCollectionIncentive: number;
  finalIncentive: number;
}

export interface IncentiveReportPdfMeta {
  fromDate: string;
  toDate: string;
  fieldOfficerCount: number;
  totalFinalIncentive: number;
}

const fmtAmt = (n: number) => formatReportAmount(n);

const fmtDate = (d: string | null) => {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};

// ─── Column groups — mirrors components/reports/IncentiveReportClient.tsx's
// module-level COLUMNS/COLUMN_GROUPS/HEADER_GROUP_RUNS/PDF_GROUP_FILL exactly
// (duplicated here, not imported, since that file is a 'use client' component
// and this module must also run server-side).

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

// PDF fill colors (RGB tuples) per group — used for the 2-row autoTable header.
const PDF_GROUP_FILL: Record<GroupId, [number, number, number]> = {
  officer: [100, 116, 139],
  active: [42, 120, 214],
  gold: [237, 161, 0],
  jlg: [27, 175, 122],
  collection: [0, 131, 0],
  od: [235, 104, 52],
  final: [74, 58, 167],
};

type ColDef = {
  key: keyof IncentiveReportRow;
  header: string;
  group: GroupId;
  render: (r: IncentiveReportRow) => string | number;
};

const COLUMNS: ColDef[] = [
  { key: "division", header: "Division", group: "officer", render: (r) => r.division || "—" },
  { key: "branch", header: "Branch", group: "officer", render: (r) => r.branch || "—" },
  { key: "dateOfJoining", header: "DOJ", group: "officer", render: (r) => fmtDate(r.dateOfJoining) },
  { key: "employeeId", header: "Emp ID", group: "officer", render: (r) => r.employeeId ?? "—" },
  { key: "staffName", header: "Staff Name", group: "officer", render: (r) => r.staffName },
  { key: "fieldOfficerCategory", header: "Category", group: "officer", render: (r) => r.fieldOfficerCategory ?? "—" },

  { key: "activeClients", header: "Active Clients", group: "active", render: (r) => r.activeClients },

  { key: "goldLoanTarget", header: "Gold Target", group: "gold", render: (r) => r.goldLoanTarget },
  { key: "goldLoanAchievedMembers", header: "Gold Achieved", group: "gold", render: (r) => r.goldLoanAchievedMembers },
  { key: "goldLoanDisbursementAmount", header: "Gold Disb. Amt", group: "gold", render: (r) => fmtAmt(r.goldLoanDisbursementAmount) },
  { key: "achievementPercent", header: "Achv %", group: "gold", render: (r) => `${r.achievementPercent}%` },
  { key: "eligibleIncentive", header: "Eligible Incentive", group: "gold", render: (r) => fmtAmt(r.eligibleIncentive) },
  { key: "goldWeightSlab1", header: "Wt 0.500-0.640", group: "gold", render: (r) => fmtAmt(r.goldWeightSlab1) },
  { key: "goldWeightSlab2", header: "Wt 0.990-1.030", group: "gold", render: (r) => fmtAmt(r.goldWeightSlab2) },
  { key: "goldWeightSlab3", header: "Wt 1.050-2.020", group: "gold", render: (r) => fmtAmt(r.goldWeightSlab3) },
  { key: "goldWeightIncentive", header: "Weight Incentive", group: "gold", render: (r) => fmtAmt(r.goldWeightIncentive) },

  { key: "jlgLoanMembers", header: "JLG Members", group: "jlg", render: (r) => r.jlgLoanMembers },
  { key: "jlgLoanDisbursement", header: "JLG Disb. Amt", group: "jlg", render: (r) => fmtAmt(r.jlgLoanDisbursement) },
  { key: "jlgIncentive", header: "IGP Incentive", group: "jlg", render: (r) => fmtAmt(r.jlgIncentive) },

  { key: "totalDemand", header: "Total Demand", group: "collection", render: (r) => fmtAmt(r.totalDemand) },
  { key: "demandCollection", header: "Demand Coll.", group: "collection", render: (r) => fmtAmt(r.demandCollection) },
  { key: "arrearCollection", header: "Arrear Coll.", group: "collection", render: (r) => fmtAmt(r.arrearCollection) },
  { key: "totalCollection", header: "Total Coll.", group: "collection", render: (r) => fmtAmt(r.totalCollection) },
  { key: "recoveryPercent", header: "Recovery %", group: "collection", render: (r) => `${r.recoveryPercent}%` },
  { key: "collectionIncentive", header: "Collection Incentive", group: "collection", render: (r) => fmtAmt(r.collectionIncentive) },

  { key: "odCollection31to60", header: "OD 31-60", group: "od", render: (r) => fmtAmt(r.odCollection31to60) },
  { key: "odCollection61to90", header: "OD 61-90", group: "od", render: (r) => fmtAmt(r.odCollection61to90) },
  { key: "odCollection91to180", header: "OD 91-180", group: "od", render: (r) => fmtAmt(r.odCollection91to180) },
  { key: "odCollectionAbove180", header: "OD >180", group: "od", render: (r) => fmtAmt(r.odCollectionAbove180) },
  { key: "odCollectionIncentive", header: "OD Incentive", group: "od", render: (r) => fmtAmt(r.odCollectionIncentive) },

  { key: "finalIncentive", header: "Final Incentive", group: "final", render: (r) => fmtAmt(r.finalIncentive) },
];

// Consecutive-run header groups, in column order (for the top banded header row).
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
 * Draws the Incentive Report — trust header, then a single A3-landscape
 * autoTable with a genuine 2-row grouped header (banded group labels via
 * colSpan, then individual column headers, both tinted per group) —
 * extracted verbatim from the Direct Download PDF logic in
 * components/reports/IncentiveReportClient.tsx's handleExportPDF, so the
 * exact same rendering can be reused by the Request Report queue's PDF
 * builder (via an injected Node-safe `drawHeader`) without duplicating the
 * table logic. `drawHeader` defaults to the browser drawPdfReportHeader, so
 * the existing Direct caller is unaffected by this extraction.
 */
export async function drawIncentiveReport(
  doc: jsPDF,
  data: IncentiveReportRow[],
  meta: IncentiveReportPdfMeta,
  reportFont: string,
  drawHeader: PdfHeaderDrawer = drawPdfReportHeader
): Promise<void> {
  const headerY = await drawHeader(doc, "Incentive Report", {
    subtitle: `Period: ${meta.fromDate} to ${meta.toDate}  |  Field Officers: ${meta.fieldOfficerCount}  |  Total Incentive: ₹${fmtAmt(meta.totalFinalIncentive)}`,
    fontFamily: reportFont,
  });

  // Row 1: banded group labels (colSpan per section). Row 2: individual column headers.
  const groupHeaderRow = HEADER_GROUP_RUNS.map((run) => ({
    content: COLUMN_GROUPS[run.group].label,
    colSpan: run.span,
    styles: { fillColor: PDF_GROUP_FILL[run.group], textColor: 255, halign: "center" as const },
  }));
  const columnHeaderRow = COLUMNS.map((c) => ({
    content: c.header,
    styles: { fillColor: PDF_GROUP_FILL[c.group], textColor: 255 },
  }));

  autoTable(doc, {
    startY: headerY,
    head: [groupHeaderRow, columnHeaderRow],
    body: data.map((r) => COLUMNS.map((c) => c.render(r))),
    styles: { font: reportFont, fontSize: 5, cellPadding: 0.8 },
    headStyles: { font: reportFont, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 250, 252] },
  });
}
