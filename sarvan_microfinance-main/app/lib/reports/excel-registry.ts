import type { BuildReportFileContext } from "@/app/lib/reports/generic-file-builder";
import { buildTaskReportQueueExcel } from "@/app/lib/reports/task-report-excel";
import { buildIncentiveReportQueueExcel } from "@/app/lib/reports/incentive-report-excel";

export type ExcelRenderer = (ctx: BuildReportFileContext) => Promise<Buffer>;

/**
 * Per-report Excel renderers that reproduce their own Direct Download Excel workbook's
 * structure (rather than the generic single-sheet flat layout every unregistered report slug
 * uses below — see generic-file-builder.ts's buildReportFile() EXCEL case, which checks this
 * registry first). Mirrors pdf-registry.ts's shape/purpose exactly, one format over.
 *
 * A reportSlug with no entry here falls straight through to the generic Excel renderer,
 * unchanged — adding a report here is the only step a future migration needs in
 * generic-file-builder.ts itself.
 */
export const excelRegistry: Record<string, ExcelRenderer> = {
  "task-report": buildTaskReportQueueExcel,
  "incentive-report": buildIncentiveReportQueueExcel,
};
