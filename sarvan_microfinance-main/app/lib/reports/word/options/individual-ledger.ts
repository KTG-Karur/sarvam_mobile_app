// Mirrors app/dashboard/reports/portfolio/individual-ledger/page.tsx's inline wordOptions
// literal. Flat, 5 columns — fetchIndividualLedger returns the exact same columns/order as
// the client's own export builder, and (since the Batch 1 shared-fetch fix) now appends its
// own trailing "TOTAL" row too — reused directly here (split off the body, reused as-is)
// rather than re-summed, since re-summing over `rows` would double-count that trailing row's
// own values into the sum.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildIndividualLedgerWordExport: WordOptionsBuilder = (headers, rows) => {
    const hasTotals = rows.length > 0 && rows[rows.length - 1][0] === 'TOTAL';
    const bodyRows = hasTotals ? rows.slice(0, -1) : rows;
    const totalsRow = hasTotals ? (rows[rows.length - 1] as (string | number)[]) : undefined;

    return {
        bodyRows,
        options: {
            columnAlignments: ['center', 'center', 'left', 'right', 'right'],
            columnWidthWeights: [8, 8, 16, 10, 10],
            totalsRow,
        },
    };
};
