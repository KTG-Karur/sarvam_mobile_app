// Mirrors components/reports/FutureDemandClient.tsx's buildFutureDemandWordOptions().
// 3 dynamic column sets by ctx.filters.reportType (OFFICERWISE/CENTERWISE/CLIENTWISE,
// default OFFICERWISE) — fetchFutureDemand branches identically and returns the exact
// same headers/row order for each mode, and (since the Batch 1 shared-fetch fix) now
// appends its own trailing "TOTAL" row too — reused directly here (split off the body,
// reused as-is) rather than re-summed, since re-summing over `rows` would double-count
// that trailing row's own values into the sum.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildFutureDemandWordExport: WordOptionsBuilder = (headers, rows, ctx) => {
    const reportType = (ctx.filters?.reportType as 'OFFICERWISE' | 'CENTERWISE' | 'CLIENTWISE') || 'OFFICERWISE';
    const hasTotals = rows.length > 0 && rows[rows.length - 1][0] === 'TOTAL';
    const bodyRows = hasTotals ? rows.slice(0, -1) : rows;
    const totalsRow = hasTotals ? (rows[rows.length - 1] as (string | number)[]) : undefined;

    if (reportType === 'CENTERWISE') {
        return {
            bodyRows,
            options: {
                columnAlignments: ['center', 'center', 'left', 'right', 'right', 'right', 'right', 'right'],
                columnWidthWeights: [8, 8, 16, 9, 9, 9, 9, 10],
                totalsRow,
            },
        };
    }
    if (reportType === 'CLIENTWISE') {
        return {
            bodyRows,
            options: {
                columnAlignments: ['center', 'center', 'left', 'left', 'right', 'right', 'right', 'right'],
                columnWidthWeights: [8, 8, 14, 12, 9, 9, 9, 10],
                totalsRow,
            },
        };
    }
    // OFFICERWISE
    return {
        bodyRows,
        options: {
            columnAlignments: ['center', 'center', 'left', 'right', 'right', 'right', 'right', 'right', 'right'],
            columnWidthWeights: [8, 8, 14, 9, 9, 9, 9, 9, 10],
            totalsRow,
        },
    };
};
