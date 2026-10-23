// Mirrors components/reports/FDOPerformanceClient.tsx's buildFdoPerformanceWordOptions().
// Flat, 20 columns, no genuine grouping (each column is a distinct metric) —
// fetchFdoPerformance returns the exact same 20 columns in the exact same order, and (since
// the Batch 1 shared-fetch fix) now appends its own trailing "TOTAL:" row too — reused
// directly here (split off the body, reused as-is) rather than re-summed, since re-summing
// over `rows` would double-count that trailing row's own values into the sum.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildFdoPerformanceWordExport: WordOptionsBuilder = (headers, rows) => {
    const hasTotals = rows.length > 0 && rows[rows.length - 1][2] === 'TOTAL:';
    const bodyRows = hasTotals ? rows.slice(0, -1) : rows;
    const totalsRow = hasTotals ? (rows[rows.length - 1] as (string | number)[]) : undefined;

    return {
        bodyRows,
        options: {
            columnAlignments: ['center', 'left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
            columnWidthWeights: [4, 10, 10, 7, 7, 6, 5, 7, 7, 7, 9, 7, 8, 8, 8, 8, 7, 6, 7, 7],
            totalsRow,
        },
    };
};
