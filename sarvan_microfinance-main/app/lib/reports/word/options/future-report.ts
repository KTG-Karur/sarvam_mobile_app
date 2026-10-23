// Mirrors components/reports/FutureReportClient.tsx's buildFutureReportWordOptions().
// Grouped, 25 columns — fetchFutureReport returns the exact same 25 columns in the exact
// same order as the client's own export builder, and (since the Batch 1 shared-fetch fix)
// now appends its own trailing "TOTAL" row too — reused directly here (split off the body,
// reused as-is) rather than re-summed, since re-summing over `rows` would double-count that
// trailing row's own values into the sum.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildFutureReportWordExport: WordOptionsBuilder = (headers, rows) => {
    const hasTotals = rows.length > 0 && rows[rows.length - 1][0] === 'TOTAL';
    const bodyRows = hasTotals ? rows.slice(0, -1) : rows;
    const totalsRow = hasTotals ? (rows[rows.length - 1] as (string | number)[]) : undefined;

    return {
        bodyRows,
        options: {
            groupHeaders: [
                { label: 'S.No', span: 1 }, { label: 'BRANCH & CENTER', span: 4 }, { label: 'FDO Name', span: 1 },
                { label: 'Loan ID', span: 1 }, { label: 'MEMBER INFO', span: 4 }, { label: 'Meetup Time', span: 1 },
                { label: 'LOAN DATES', span: 3 }, { label: 'Loan Amount', span: 1 }, { label: 'OUTSTANDING', span: 3 },
                { label: 'Due Date', span: 1 }, { label: 'Due No', span: 1 }, { label: 'DUE', span: 3 },
                { label: 'Funder Name', span: 1 },
            ],
            subHeaders: ['Branch ID', 'Branch Name', 'Centre ID', 'Center Name', 'Unique ID', 'Name', 'Phone', 'Aadhar', 'Disb. Date', '1st EMI Date', 'Maturity Date', 'Principal', 'Interest', 'Total', 'Principal', 'Interest', 'Total'],
            columnAlignments: ['center', 'center', 'left', 'center', 'left', 'left', 'center', 'center', 'left', 'center', 'center', 'center', 'center', 'center', 'center', 'right', 'right', 'right', 'right', 'center', 'center', 'right', 'right', 'right', 'left'],
            columnWidthWeights: [3, 6, 9, 6, 9, 9, 7, 7, 9, 9, 7, 8, 7, 7, 7, 7, 7, 7, 7, 7, 6, 7, 7, 7, 9],
            totalsRow,
        },
    };
};
