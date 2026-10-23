// Mirrors components/reports/AdditionDisbursedClient.tsx's buildAdditionDisbursedWordOptions().
// Flat, 11 columns, no grouping — fetchAdditionDisbursed returns the exact same columns/order
// as the client's own export builder, and (since the Batch 2 shared-fetch fix) now appends
// its own trailing "Grand Total" row too — reused directly here (split off the body, reused
// as-is) rather than re-summed, since re-summing over `rows` would double-count that trailing
// row's own values into the sum.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildAdditionDisbursedWordExport: WordOptionsBuilder = (headers, rows) => {
    const hasTotals = rows.length > 0 && rows[rows.length - 1][0] === 'Grand Total';
    const bodyRows = hasTotals ? rows.slice(0, -1) : rows;
    const totalsRow = hasTotals ? (rows[rows.length - 1] as (string | number)[]) : undefined;

    return {
        bodyRows,
        options: {
            columnAlignments: ['center', 'left', 'center', 'left', 'center', 'center', 'center', 'right', 'right', 'left', 'left'],
            columnWidthWeights: [8, 12, 8, 12, 8, 8, 8, 9, 9, 9, 10],
            totalsRow,
        },
    };
};
