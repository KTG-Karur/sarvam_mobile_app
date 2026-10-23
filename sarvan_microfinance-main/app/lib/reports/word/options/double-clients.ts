// Mirrors components/reports/DoubleClientsClient.tsx's `wordOptions` literal. Flat, 11
// columns, no totals row (none exists in the direct export either) — fetchDoubleClients
// returns the exact same 11 columns in the exact same order.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildDoubleClientsWordExport: WordOptionsBuilder = (headers, rows) => ({
    bodyRows: rows,
    options: {
        columnAlignments: ['center', 'left', 'center', 'center', 'center', 'center', 'center', 'center', 'center', 'right', 'left'],
        columnWidthWeights: [6, 14, 8, 10, 8, 10, 9, 10, 9, 9, 12],
    },
});
