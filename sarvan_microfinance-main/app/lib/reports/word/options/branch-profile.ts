// Mirrors components/reports/BranchProfileClient.tsx's wordOptions literal. Freeform
// label/value profile sheet (not a uniform record grid) — no grouped headers, no totals row,
// just alignment/width styling. fetchBranchProfile returns the same 6-column
// (Field/Value x3) shape as the client's own builder.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildBranchProfileWordExport: WordOptionsBuilder = (headers, rows) => ({
    bodyRows: rows,
    options: {
        columnAlignments: ['left', 'right', 'left', 'right', 'left', 'right'],
        columnWidthWeights: [10, 8, 10, 8, 10, 8],
    },
});
