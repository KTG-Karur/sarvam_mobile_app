// Mirrors app/dashboard/admin-reports/funders/funder-report/page.tsx's
// buildFunderReportWordOptions(). Flat, 5 columns — fetchFunderReport returns the same
// headers/order as the client's own export builder, and (since the Batch 1 shared-fetch fix)
// now appends its own trailing "TOTAL" row too — reused directly here (split off the body,
// reused as-is) rather than re-summed, since re-summing over `rows` would double-count that
// trailing row's own values into the sum.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildFunderReportWordExport: WordOptionsBuilder = (headers, rows) => {
    const hasTotals = rows.length > 0 && rows[rows.length - 1][0] === 'TOTAL';
    const bodyRows = hasTotals ? rows.slice(0, -1) : rows;
    const totalsRow = hasTotals ? (rows[rows.length - 1] as (string | number)[]) : undefined;

    return {
        bodyRows,
        options: {
            columnAlignments: ['left', 'right', 'right', 'right', 'right'],
            columnWidthWeights: [16, 10, 9, 9, 10],
            totalsRow,
        },
    };
};
