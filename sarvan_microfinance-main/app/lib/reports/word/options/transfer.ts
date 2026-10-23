// Mirrors components/reports/TransferClient.tsx's static `wordOptions` literal. Flat, no
// totals row (transfer log, not a financial roll-up — none exists in the direct export
// either). fetchTransfer (report-registry.ts) returns the exact same 9 columns in the exact
// same order as the client's own buildTransferExportRows().
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildTransferWordExport: WordOptionsBuilder = (headers, rows) => ({
    bodyRows: rows,
    options: {
        columnAlignments: ['left', 'center', 'center', 'left', 'left', 'center', 'center', 'left', 'left'],
        columnWidthWeights: [14, 10, 10, 12, 12, 8, 8, 10, 14],
    },
});
