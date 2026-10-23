// Mirrors components/reports/DropoutsClient.tsx's `wordOptions` literal. Flat, 12 columns,
// no totals row (client list, not a financial roll-up) — fetchDropouts returns the exact
// same 12 columns in the exact same order.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildDropoutsWordExport: WordOptionsBuilder = (headers, rows) => ({
    bodyRows: rows,
    options: {
        columnAlignments: ['center', 'left', 'center', 'left', 'center', 'center', 'center', 'center', 'center', 'center', 'left', 'left'],
        columnWidthWeights: [7, 12, 7, 12, 9, 9, 10, 8, 10, 9, 12, 10],
    },
});
