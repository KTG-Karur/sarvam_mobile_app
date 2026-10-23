// Mirrors app/dashboard/admin-reports/account/compare-ilgl/page.tsx's inline `wordOptions`
// literal. Flat, 4 columns, no totals row, no grouping — fetchCompareIlgl returns the exact
// same 4 columns in the exact same order as the client's own export builder.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildCompareIlglWordExport: WordOptionsBuilder = (headers, rows) => ({
    bodyRows: rows,
    options: {
        columnAlignments: ['left', 'right', 'right', 'right'],
        columnWidthWeights: [14, 11, 11, 10],
    },
});
