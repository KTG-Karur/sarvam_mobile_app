// Mirrors app/dashboard/admin-reports/account/gl-one/page.tsx's buildGLOneWordOptions().
// reportSlug is 'gl-account-ledger' (not 'gl-one') — see the page's ExportDropdown prop.
// Flat, 5 columns, trailing "Closing Balance" row split off as the distinct totals row —
// fetchGlOne returns the same headers/order/trailing-row shape as the client's own builder.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildGlAccountLedgerWordExport: WordOptionsBuilder = (headers, rows) => ({
    bodyRows: rows.slice(0, -1),
    options: {
        columnAlignments: ['left', 'left', 'right', 'right', 'right'],
        columnWidthWeights: [10, 16, 9, 9, 9],
        totalsRow: rows[rows.length - 1],
    },
});
