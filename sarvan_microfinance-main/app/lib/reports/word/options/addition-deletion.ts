// Mirrors components/reports/AdditionDeletionClient.tsx's buildAdditionDeletionWordOptions().
// Flat, 8 columns, no grouping — fetchAdditionDeletion returns the exact same columns/order
// as the client's own export builder, but does not append its own grand-total row, so it's
// reconstructed here by summing Opening/Induction/Dropped/Closing/Admission Fees
// (indices 3-7). Rows come back empty of a totals row from the registry fetch, so a totals
// row is always added here (mirroring the client's `hasTotals` check, which is only false
// when there are zero rows).
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildAdditionDeletionWordExport: WordOptionsBuilder = (headers, rows) => {
    if (rows.length === 0) {
        return { bodyRows: rows, options: { columnAlignments: ['center', 'left', 'left', 'right', 'right', 'right', 'right', 'right'], columnWidthWeights: [6, 14, 14, 9, 9, 9, 9, 10] } };
    }
    const sum = (colIndex: number) => rows.reduce((s, r) => s + Number(r[colIndex] ?? 0), 0);
    const totalsRow = ['', 'Grand Total:', '', sum(3), sum(4), sum(5), sum(6), sum(7)];

    return {
        bodyRows: rows,
        options: {
            columnAlignments: ['center', 'left', 'left', 'right', 'right', 'right', 'right', 'right'],
            columnWidthWeights: [6, 14, 14, 9, 9, 9, 9, 10],
            totalsRow,
        },
    };
};
