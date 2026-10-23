// Mirrors app/dashboard/admin-reports/funders/funder-interest/page.tsx's
// buildFunderInterestWordOptions(). Grouped (12 monthly columns), trailing TOTAL row split
// off as the distinct totals row — fetchFunderInterest's FUNDER_INTEREST_FY_MONTHS order
// (apr..mar) matches the client's own FY_MONTHS order exactly, so the 14-column layout lines
// up 1:1 (Funder Name, 12 months, Total Payment).
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildFunderInterestWordExport: WordOptionsBuilder = (headers, rows) => ({
    bodyRows: rows.slice(0, -1),
    options: {
        groupHeaders: [
            { label: 'Funder Name', span: 1 },
            { label: 'MONTHLY INTEREST', span: 12 },
            { label: 'Total Payment', span: 1 },
        ],
        subHeaders: ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'],
        columnAlignments: ['left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
        columnWidthWeights: [14, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 9],
        totalsRow: rows[rows.length - 1],
    },
});
