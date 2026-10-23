// Mirrors components/mis-reports/LoanOSDetailsClient.tsx's buildLoanOSWordOptions().
// Grouped (Loan/OS/Arrear/Dues/Due Principal-Interest clusters), 26 columns —
// fetchLoanOsDetails returns the exact same 26 columns/order as the client's own export
// builder, and (since the Batch 1 shared-fetch fix) now appends its own trailing
// "Grand Total:" row too — reused directly here (split off the body, reused as-is) rather
// than re-summed, since re-summing over `rows` would double-count that trailing row's own
// values into the sum.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildLoanOsDetailsWordExport: WordOptionsBuilder = (headers, rows) => {
    const hasTotals = rows.length > 0 && rows[rows.length - 1][0] === 'Grand Total:';
    const bodyRows = hasTotals ? rows.slice(0, -1) : rows;
    const totalsRow = hasTotals ? (rows[rows.length - 1] as (string | number)[]) : undefined;

    return {
        bodyRows,
        options: {
            groupHeaders: [
                { label: 'Branch Name', span: 1 }, { label: 'Center Name', span: 1 }, { label: 'Account ID', span: 1 },
                { label: 'Client Name', span: 1 }, { label: 'Loan A/c', span: 1 }, { label: 'Disbursal Date', span: 1 },
                { label: 'Due Start Date', span: 1 }, { label: 'Maturity Date', span: 1 }, { label: 'Status', span: 1 },
                { label: 'LOAN', span: 2 }, { label: 'OS', span: 2 }, { label: 'ARREAR', span: 2 },
                { label: 'DUES', span: 3 }, { label: 'DUE', span: 2 }, { label: 'DPD', span: 1 }, { label: 'Ageing', span: 1 },
                { label: 'Mobile', span: 1 }, { label: 'FDO Name', span: 1 }, { label: 'Meeting Day', span: 1 },
                { label: 'Disbural Type', span: 1 },
            ],
            subHeaders: ['Amount', 'Interest', 'Principal', 'Interest', 'Principal', 'Interest', 'Total', 'Completed', 'Collected', 'Principal', 'Interest'],
            columnAlignments: ['left', 'left', 'center', 'left', 'center', 'center', 'center', 'center', 'center', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'center', 'left', 'center', 'center'],
            columnWidthWeights: [10, 10, 8, 12, 8, 8, 8, 8, 8, 7, 7, 7, 7, 7, 7, 7, 7, 7, 6, 6, 6, 6, 8, 9, 8, 8],
            totalsRow,
        },
    };
};
