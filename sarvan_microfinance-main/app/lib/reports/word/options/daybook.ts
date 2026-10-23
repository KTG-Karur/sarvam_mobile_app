// Mirrors app/dashboard/admin-reports/account/daybook/page.tsx's inline `daybookWordOptions`
// literal. Flat, 7 columns (fetchDaybook returns the same headers/order as the client's own
// export builder). No totals row extracted — the client's own comment explains why: the
// Total/Closing Balance rows sit in the middle of the report (a denomination breakdown follows),
// not at the end, so there's no single trailing row to safely style as distinct. Note: unlike
// the direct export, fetchDaybook does not append the trailing denomination-breakdown section —
// that section is built purely from the client's own local cash-count state, not registry data.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildDaybookWordExport: WordOptionsBuilder = (headers, rows) => ({
    bodyRows: rows,
    options: {
        columnAlignments: ['center', 'center', 'left', 'center', 'left', 'right', 'right'],
        columnWidthWeights: [5, 9, 10, 8, 18, 8, 8],
    },
});
