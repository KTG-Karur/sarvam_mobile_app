// Mirrors components/mis-reports/PerformanceClient.tsx's buildPerformanceWordOptions().
// Grouped, A3 landscape, 33 columns — fetchPerformanceReport (report-registry.ts) returns
// the exact same 33 columns/order and already appends the identical TOTAL row itself, so
// it's reused verbatim by slicing it off — no server-side recomputation needed.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildPerformanceReportWordExport: WordOptionsBuilder = (headers, rows) => ({
    bodyRows: rows.slice(0, -1),
    options: {
        groupHeaders: [
            { label: 'SNO', span: 1 }, { label: 'Branch', span: 1 }, { label: 'Address', span: 1 },
            { label: 'Total Centers', span: 1 }, { label: 'Total Members', span: 1 }, { label: '100% Att. Clients', span: 1 },
            { label: 'Active', span: 1 }, { label: 'NR', span: 1 }, { label: 'New Members', span: 1 },
            { label: 'Members Dropout', span: 1 }, { label: 'FDO', span: 1 }, { label: 'Supervisor', span: 1 },
            { label: 'DEMAND', span: 2 }, { label: 'Collection', span: 1 }, { label: 'Preclosure', span: 1 },
            { label: 'AMOUNT', span: 3 }, { label: 'COLLECTION', span: 2 },
            { label: 'Arrear Amount', span: 1 }, { label: 'Outstanding', span: 1 }, { label: 'Advance', span: 1 },
            { label: 'Arr Pre Amount', span: 1 }, { label: 'CHARGES', span: 8 },
        ],
        subHeaders: ['New', 'Old', 'New', 'Old', 'Total', 'Collected', 'Amount', 'Charges', 'Bales', 'Lives', 'Rent', 'Chabeeb', 'Classic', 'Appl.', 'Processing'],
        columnAlignments: ['center', 'left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
        columnWidthWeights: [4, 10, 12, 7, 7, 7, 6, 5, 7, 7, 9, 9, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 6, 6, 6, 7, 7],
        totalsRow: rows[rows.length - 1],
        pageSize: { widthMm: 297, heightMm: 420 },
    },
});
