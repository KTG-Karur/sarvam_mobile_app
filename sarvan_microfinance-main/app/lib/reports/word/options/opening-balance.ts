// Mirrors components/accounts/OpeningBalanceClient.tsx's inline wordOptions literal. Flat,
// 5 columns, no totals row (none exists in this report) — fetchOpeningBalance returns the
// exact same columns/order as the client's own export builder.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildOpeningBalanceWordExport: WordOptionsBuilder = (headers, rows) => ({
    bodyRows: rows,
    options: {
        columnAlignments: ['center', 'left', 'center', 'center', 'right'],
        columnWidthWeights: [4, 18, 10, 12, 12],
    },
});
