// Mirrors components/mis-reports/PreclosureClient.tsx's buildPreclosureWordOptions()
// (reportSlug 'preclosure', MIS Preclosure Report Consolidated — distinct from the
// portfolio Preclosure report). Grouped (Arrear/Current Demand/Preclosure Principal-Interest
// pairs), 12 columns — fetchPreclosure returns the exact same columns/order as the client's
// own export builder, and (since the Batch 1 shared-fetch fix) now appends its own trailing
// "Grand Total:" row too — reused directly here (split off the body, reused as-is) rather
// than re-summed, since re-summing over `rows` would double-count that trailing row's own
// values into the sum.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildPreclosureWordExport: WordOptionsBuilder = (headers, rows) => {
    const hasTotals = rows.length > 0 && rows[rows.length - 1][0] === 'Grand Total:';
    const bodyRows = hasTotals ? rows.slice(0, -1) : rows;
    const totalsRow = hasTotals ? (rows[rows.length - 1] as (string | number)[]) : undefined;

    return {
        bodyRows,
        options: {
            groupHeaders: [
                { label: 'Preclose Date', span: 1 }, { label: 'Branch Name', span: 1 }, { label: 'Center Name', span: 1 },
                { label: 'Client Name', span: 1 }, { label: 'Loan A/c', span: 1 }, { label: 'ARREAR', span: 2 },
                { label: 'CURRENT DEMAND', span: 2 }, { label: 'PRECLOSURE', span: 2 }, { label: 'Total Amount', span: 1 },
            ],
            subHeaders: ['Principal', 'Interest', 'Principal', 'Interest', 'Principal', 'Interest'],
            columnAlignments: ['center', 'left', 'left', 'left', 'center', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
            columnWidthWeights: [8, 12, 12, 12, 8, 7, 7, 7, 7, 7, 7, 9],
            totalsRow,
        },
    };
};
