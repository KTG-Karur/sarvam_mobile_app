// Mirrors app/dashboard/mis-reports/disbursement/page.tsx's buildDisbursementWordOptions().
// Light grouping (Branch/Center/Member ID+Name pairs), 18 columns — fetchMisDisbursement
// returns the exact same 18 columns in the exact same order as the client's own export
// builder. totalsRow is reconstructed by summing the Loan Amount column (index 9).
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildMisDisbursementWordExport: WordOptionsBuilder = (headers, rows) => {
    const sum = (colIndex: number) => rows.reduce((s, r) => s + Number(r[colIndex] ?? 0), 0);
    const totalsRow = new Array(headers.length).fill('');
    totalsRow[0] = 'Grand Total';
    totalsRow[9] = sum(9);

    return {
        bodyRows: rows,
        options: {
            groupHeaders: [
                { label: 'BRANCH', span: 2 }, { label: 'Disbursal Date', span: 1 }, { label: 'CENTER', span: 2 },
                { label: 'MEMBER', span: 2 }, { label: 'Funder', span: 1 }, { label: 'Loan A/C No', span: 1 },
                { label: 'Loan Amount', span: 1 }, { label: 'Total Dues', span: 1 }, { label: 'Purpose', span: 1 },
                { label: 'Emp ID', span: 1 }, { label: 'FDO', span: 1 }, { label: 'Due Start Date', span: 1 },
                { label: 'Loan Sl No', span: 1 }, { label: 'Phone', span: 1 }, { label: 'Meeting Day', span: 1 },
            ],
            subHeaders: ['ID', 'Name', 'ID', 'Name', 'ID', 'Name'],
            columnAlignments: ['center', 'left', 'center', 'center', 'left', 'center', 'left', 'left', 'center', 'right', 'right', 'left', 'center', 'left', 'center', 'center', 'center', 'center'],
            columnWidthWeights: [6, 10, 8, 6, 10, 6, 10, 9, 8, 8, 8, 10, 7, 7, 8, 7, 8, 8],
            totalsRow,
        },
    };
};
