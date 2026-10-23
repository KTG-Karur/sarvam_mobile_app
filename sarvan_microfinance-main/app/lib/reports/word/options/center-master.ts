// Mirrors components/reports/CenterMasterClient.tsx's buildCenterMasterClientWordOptions().
// 17 flat columns, no grouping (each metric is distinct). totalsRow is reconstructed by
// summing Clients/Waiting Borrowers/Portfolio/Arrear/Advance/Adv Adjustment/Preclosure
// (indices 10-16) across the fetched rows — fetchCenterMaster returns the exact same 17
// columns in the exact same order.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildCenterMasterWordExport: WordOptionsBuilder = (headers, rows) => {
    const sum = (colIndex: number) => rows.reduce((s, r) => s + Number(r[colIndex] ?? 0), 0);
    const totalsRow = ['', 'Grand Total:', '', '', '', '', '', '', '', '', sum(10), sum(11), sum(12), sum(13), sum(14), sum(15), sum(16)];

    return {
        bodyRows: rows,
        options: {
            columnAlignments: ['center', 'center', 'center', 'left', 'left', 'center', 'center', 'right', 'left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
            columnWidthWeights: [5, 8, 8, 12, 10, 8, 8, 8, 10, 9, 7, 8, 8, 7, 7, 8, 7],
            totalsRow,
        },
    };
};
