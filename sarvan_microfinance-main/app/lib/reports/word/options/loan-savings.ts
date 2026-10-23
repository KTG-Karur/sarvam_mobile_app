// Mirrors components/reports/LoanSavingsReportClient.tsx's buildLoanAdvanceWordOptions().
// Flat, 15 columns — fetchLoanSavings returns the exact same 15 columns in the exact same
// order, and already appends the identical inline 'TOTAL' row the client computes, so it's
// simply sliced off the already-fetched rows.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildLoanSavingsWordExport: WordOptionsBuilder = (headers, rows) => {
    const hasTotals = rows.length > 0 && rows[rows.length - 1][0] === 'TOTAL';
    return {
        bodyRows: hasTotals ? rows.slice(0, -1) : rows,
        options: {
            columnAlignments: ['center', 'left', 'left', 'left', 'center', 'left', 'center', 'left', 'left', 'center', 'left', 'left', 'center', 'center', 'right'],
            columnWidthWeights: [4, 9, 9, 9, 7, 10, 7, 10, 9, 7, 10, 9, 8, 8, 9],
            totalsRow: hasTotals ? rows[rows.length - 1] : undefined,
        },
    };
};
