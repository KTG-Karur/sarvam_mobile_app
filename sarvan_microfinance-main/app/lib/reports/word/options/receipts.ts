// Mirrors components/reports/ReceiptsClient.tsx's buildReceiptsWordOptions(). Grouped
// (Demand/Collection Principal-Interest pairs), 16 columns — fetchReceipts
// (report-registry.ts) returns the exact same column order as the client's own
// buildReceiptsExportRows(), and always appends a ['', ..., 'GRAND TOTAL', ...] row in the
// same shape, so totals detection uses the same row-content check rather than a
// component-local `totals` flag.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildReceiptsWordExport: WordOptionsBuilder = (headers, rows) => {
    const hasTotals = rows.length > 0 && rows[rows.length - 1][6] === 'GRAND TOTAL';
    return {
        bodyRows: hasTotals ? rows.slice(0, -1) : rows,
        options: {
            groupHeaders: [
                { label: 'S.No', span: 1 },
                { label: 'Center Name', span: 1 },
                { label: 'Client Name', span: 1 },
                { label: 'Account No', span: 1 },
                { label: 'Loan A/c', span: 1 },
                { label: 'Ref No', span: 1 },
                { label: 'Receipt Date', span: 1 },
                { label: 'DEMAND', span: 2 },
                { label: 'COLLECTION', span: 4 },
                { label: 'Mode', span: 1 },
                { label: 'Collected By', span: 1 },
                { label: 'Trans Type', span: 1 },
            ],
            subHeaders: ['Principal', 'Interest', 'Principal', 'Interest', 'Loan Advance', 'Total'],
            columnAlignments: [
                'center', 'left', 'left', 'center', 'center', 'center', 'center',
                'right', 'right', 'right', 'right', 'right', 'right',
                'center', 'left', 'center',
            ],
            columnWidthWeights: [4, 12, 14, 8, 8, 8, 8, 7, 7, 7, 7, 8, 9, 7, 10, 8],
            totalsRow: hasTotals ? (rows[rows.length - 1] as (string | number)[]) : undefined,
        },
    };
};
