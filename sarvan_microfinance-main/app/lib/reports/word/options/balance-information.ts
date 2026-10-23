// Mirrors components/reports/BalanceInformationReport.tsx's buildBalanceInfoWordOptions().
// 12 columns, light grouping (OS Principle/Interest and Arrear Pri/Int pairs). totalsRow is
// reconstructed by summing OS Principle/Interest (indices 7/8) and Arrear Pri/Int (9/10) across
// the fetched rows — fetchBalanceInformation returns the exact same 12 columns in the same order.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildBalanceInformationWordExport: WordOptionsBuilder = (headers, rows) => {
    const sum = (colIndex: number) => rows.reduce((s, r) => s + Number(r[colIndex] ?? 0), 0);
    const totalsRow = ['', 'Grand Total:', '', '', '', '', '', sum(7), sum(8), sum(9), sum(10), ''];

    return {
        bodyRows: rows,
        options: {
            groupHeaders: [
                { label: 'Sl No', span: 1 }, { label: 'Branch', span: 1 }, { label: 'Center', span: 1 },
                { label: 'FDO', span: 1 }, { label: 'Meeting Day', span: 1 }, { label: 'Client', span: 1 },
                { label: 'Account ID', span: 1 }, { label: 'OS', span: 2 }, { label: 'ARREAR', span: 2 },
                { label: 'Mobile', span: 1 },
            ],
            subHeaders: ['Principle', 'Interest', 'Pri', 'Int'],
            columnAlignments: ['center', 'left', 'left', 'left', 'center', 'left', 'center', 'right', 'right', 'right', 'right', 'center'],
            columnWidthWeights: [5, 10, 10, 9, 8, 12, 8, 8, 8, 8, 8, 9],
            totalsRow,
        },
    };
};
