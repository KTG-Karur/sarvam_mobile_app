// Mirrors app/dashboard/mis-reports/branch-demand/page.tsx's inline `wordOptions` literal.
// Flat, 10 columns — fetchMisBranchDemand returns the exact same headers/order as the
// client's own export builder, and (since the Batch 1 shared-fetch fix) now appends its own
// trailing "TOTAL" row too — reused directly here (split off the body, reused as-is) rather
// than re-summed, since re-summing over `rows` would double-count that trailing row's own
// values into the sum.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildMisBranchDemandWordExport: WordOptionsBuilder = (headers, rows) => {
    const hasTotals = rows.length > 0 && rows[rows.length - 1][0] === 'TOTAL';
    const bodyRows = hasTotals ? rows.slice(0, -1) : rows;
    const totalsRow = hasTotals ? (rows[rows.length - 1] as (string | number)[]) : undefined;

    return {
        bodyRows,
        options: {
            columnAlignments: ['center', 'center', 'left', 'center', 'left', 'right', 'right', 'right', 'right', 'right'],
            columnWidthWeights: [9, 8, 14, 8, 12, 7, 8, 8, 9, 9],
            totalsRow,
        },
    };
};
