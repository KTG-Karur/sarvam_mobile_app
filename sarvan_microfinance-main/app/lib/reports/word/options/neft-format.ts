// Mirrors components/reports/NEFTFormatClient.tsx's buildNEFTWordOptions(). Grouped, 16
// columns — fetchNeftFormat (report-registry.ts) returns the exact same column order as the
// client's own buildNEFTExportRows(), and already appends its own ['', 'Grand Total', ...,
// totalLoanAmount] row identical in shape to the client's, so the same hasTotals check
// (rows[last][1] === 'Grand Total') works unchanged.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildNeftFormatWordExport: WordOptionsBuilder = (headers, rows) => {
    const hasTotals = rows.length > 0 && rows[rows.length - 1][1] === 'Grand Total';
    return {
        bodyRows: hasTotals ? rows.slice(0, -1) : rows,
        options: {
            groupHeaders: [
                { label: 'S NO', span: 1 }, { label: 'LOCATION', span: 3 }, { label: 'BRANCH & CENTER', span: 4 },
                { label: 'LOAN ID', span: 1 }, { label: 'MEMBER ID', span: 1 }, { label: 'ACCOUNT', span: 2 },
                { label: 'MEMBER NAME', span: 1 }, { label: 'BANK', span: 2 }, { label: 'LOAN AMOUNT', span: 1 },
            ],
            subHeaders: ['REGION NAME', 'DIVISION NAME', 'AREA NAME', 'BRANCH ID', 'BRANCH NAME', 'CENTRE ID', 'CENTER NAME', 'IFSC CODE', 'ACCOUNT NUMBER', 'BANK NAME', 'BANK BRANCH NAME'],
            columnAlignments: ['center', 'left', 'left', 'left', 'center', 'left', 'center', 'left', 'center', 'center', 'center', 'center', 'left', 'left', 'left', 'right'],
            columnWidthWeights: [4, 9, 9, 9, 6, 10, 6, 10, 8, 8, 8, 10, 11, 10, 10, 8],
            totalsRow: hasTotals ? (rows[rows.length - 1] as (string | number)[]) : undefined,
        },
    };
};
