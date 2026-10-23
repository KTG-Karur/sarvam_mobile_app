// Mirrors app/dashboard/admin-reports/account/gl-all/page.tsx's inline `wordOptions` literal.
// Flat, 6 columns, no single totals row (repeats an Account/Opening/transactions/Closing block
// per account) — fetchGlAll returns the same headers/order as the client's own export builder.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildGlAllWordExport: WordOptionsBuilder = (headers, rows) => ({
    bodyRows: rows,
    options: {
        columnAlignments: ['left', 'left', 'center', 'left', 'right', 'right'],
        columnWidthWeights: [10, 10, 8, 16, 9, 9],
    },
});
