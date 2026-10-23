// Mirrors app/dashboard/mis-reports/all-dcb/page.tsx's inline `wordOptions` literal.
// Flat, 15 columns — fetchMisAllDcb returns the exact same headers/order as the client's own
// export builder, but (unlike the client) has no trailing Grand Total row, so it's
// reconstructed by summing the numeric columns; Rec % (a ratio, not summable) is left blank
// in the totals row rather than invented.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildMisAllDcbWordExport: WordOptionsBuilder = (headers, rows) => {
    // fetchMisAllDcb (report-registry.ts) drops the "Advance Coll" column entirely
    // when the feature is disabled — detect that from the header count (15 with, 14
    // without) rather than hardcoding, so this stays in sync.
    const loanAdvanceEnabled = headers.length === 15;
    const sum = (colIndex: number) => rows.reduce((s, r) => s + Number(r[colIndex] ?? 0), 0);
    const totalsRow = loanAdvanceEnabled
        ? ['', 'GRAND TOTAL', sum(2), sum(3), sum(4), sum(5), sum(6), '', sum(8), sum(9), sum(10), sum(11), sum(12), sum(13), sum(14)]
        : ['', 'GRAND TOTAL', sum(2), sum(3), sum(4), sum(5), sum(6), '', sum(8), sum(9), sum(10), sum(11), sum(12), sum(13)];

    return {
        bodyRows: rows,
        options: {
            columnAlignments: loanAdvanceEnabled
                ? ['left', 'center', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right']
                : ['left', 'center', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
            columnWidthWeights: loanAdvanceEnabled
                ? [14, 8, 6, 6, 7, 7, 7, 6, 7, 7, 7, 7, 7, 7, 7]
                : [14, 8, 6, 6, 7, 7, 7, 6, 7, 7, 7, 7, 7, 7],
            totalsRow,
        },
    };
};
