// Mirrors app/dashboard/admin-reports/portfolio/os-clientwise/page.tsx's inline `wordOptions`
// literal. reportSlug is 'os-clientwise-admin'. Grouped (OS/ARREAR pairs), no totals row —
// fetchOSClientwiseCore (via OS_CLIENTWISE_HEADERS/osClientwiseRowsOf) returns the exact same
// 14 columns/order as the client's own export builder.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildOsClientwiseAdminWordExport: WordOptionsBuilder = (headers, rows) => ({
    bodyRows: rows,
    options: {
        groupHeaders: [
            { label: 'Branch Name', span: 1 }, { label: 'Center Name', span: 1 }, { label: 'Client Name', span: 1 },
            { label: 'Disbursal Date', span: 1 }, { label: 'Loan Amount', span: 1 }, { label: 'Due Start Date', span: 1 },
            { label: 'Tenure', span: 1 }, { label: 'Loan A/c', span: 1 }, { label: 'OS', span: 2 },
            { label: 'ARREAR', span: 2 }, { label: 'Funder', span: 1 }, { label: 'Mobile #', span: 1 },
        ],
        subHeaders: ['Principle', 'Interest', 'Pri', 'Int'],
        columnAlignments: ['left', 'left', 'left', 'center', 'right', 'center', 'center', 'center', 'right', 'right', 'right', 'right', 'left', 'center'],
        columnWidthWeights: [10, 10, 12, 8, 8, 8, 6, 8, 8, 8, 8, 8, 9, 8],
    },
});
