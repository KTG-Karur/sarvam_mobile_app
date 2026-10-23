// Mirrors components/reports/WaitingBorrowersClient.tsx's buildWaitingBorrowersWordOptions().
// Two flat variants selected the same way fetchWaitingBorrowers (report-registry.ts) itself
// branches: `filters.reportType === 'SUMMARY'` vs the default 'DETAILED' — both variants'
// column order/count match the client's own buildWaitingBorrowersExportRows() exactly.
// totalsRow uses the same 'Grand Total:' row-content check as the client (neither registry
// variant appends one today, so this naturally evaluates the same way).
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildWaitingBorrowersWordExport: WordOptionsBuilder = (headers, rows, ctx) => {
    const reportType = ctx.filters?.reportType ?? 'DETAILED';
    const hasTotals = rows.length > 0 && rows[rows.length - 1][0] === 'Grand Total:';
    const bodyRows = hasTotals ? rows.slice(0, -1) : rows;
    const totalsRow = hasTotals ? (rows[rows.length - 1] as (string | number)[]) : undefined;

    if (reportType === 'DETAILED') {
        return {
            bodyRows,
            options: {
                columnAlignments: ['left', 'left', 'center', 'left', 'center', 'center', 'center', 'center', 'right', 'center'],
                columnWidthWeights: [10, 12, 8, 14, 9, 9, 9, 9, 9, 9],
                totalsRow,
            },
        };
    }
    return {
        bodyRows,
        options: {
            columnAlignments: ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
            columnWidthWeights: [12, 12, 9, 10, 9, 10, 9, 10, 9],
            totalsRow,
        },
    };
};
