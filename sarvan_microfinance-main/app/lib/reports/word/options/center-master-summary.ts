// Mirrors app/dashboard/admin-reports/portfolio/center-master-report/page.tsx's inline
// `wordOptions` literal. reportSlug is 'center-master-summary'. Grouped (Arrear
// Members/Amount/Mem OS triad), no totals row — fetchCenterMasterSummary returns the exact
// same 20 columns/order as the client's own export builder.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildCenterMasterSummaryWordExport: WordOptionsBuilder = (headers, rows) => ({
    bodyRows: rows,
    options: {
        groupHeaders: [
            { label: 'Branch ID', span: 1 }, { label: 'Centre ID', span: 1 }, { label: 'Centre Name', span: 1 },
            { label: 'Visit Date', span: 1 }, { label: 'FDO Name', span: 1 }, { label: 'Meeting Day', span: 1 },
            { label: 'Meeting Time', span: 1 }, { label: 'From Branch', span: 1 }, { label: 'From DO', span: 1 },
            { label: 'Contact Person', span: 1 }, { label: 'Contact Number', span: 1 },
            { label: 'Distance from Branch (KM)', span: 1 }, { label: 'No. of Members', span: 1 },
            { label: 'Active Clients', span: 1 }, { label: 'OS Principal', span: 1 }, { label: 'ARREAR', span: 3 },
            { label: 'Waiting Borrowers', span: 1 }, { label: 'PAR (%)', span: 1 },
        ],
        subHeaders: ['Members', 'Amount', 'Mem OS'],
        columnAlignments: ['center', 'center', 'left', 'center', 'left', 'center', 'center', 'left', 'left', 'left', 'center', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
        columnWidthWeights: [6, 6, 12, 8, 10, 8, 8, 10, 8, 10, 8, 8, 7, 7, 8, 7, 7, 8, 8, 7],
    },
});
