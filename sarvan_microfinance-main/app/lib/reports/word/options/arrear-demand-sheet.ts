// Mirrors app/dashboard/reports/demand/arrear-demand-sheet/page.tsx's
// buildArrearDemandWordOptions(). Grouped (ARREAR/COLLECTION clusters), 14 columns —
// fetchArrearDemandSheet uses the same getArrearDemandSheetDataCore() and returns the exact
// same 14 columns in the exact same order as the client's own export builder. totalsRow is
// reconstructed by summing the Arrear Principal/Interest/Fees Due/Penalties Due/Total Arrear
// Due columns (indices 4-8).
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildArrearDemandSheetWordExport: WordOptionsBuilder = (headers, rows) => {
    const sum = (colIndex: number) => rows.reduce((s, r) => s + Number(r[colIndex] ?? 0), 0);
    const totalsRow = new Array(headers.length).fill('');
    totalsRow[0] = 'Total';
    totalsRow[4] = sum(4);
    totalsRow[5] = sum(5);
    totalsRow[6] = sum(6);
    totalsRow[7] = sum(7);
    totalsRow[8] = sum(8);

    return {
        bodyRows: rows,
        options: {
            groupHeaders: [
                { label: 'S.No', span: 1 },
                { label: 'Member ID', span: 1 },
                { label: 'Member Name', span: 1 },
                { label: 'Loan ID', span: 1 },
                { label: 'ARREAR', span: 5 },
                { label: 'COLLECTION', span: 5 },
            ],
            subHeaders: ['Principal', 'Interest', 'Fees Due', 'Penalties Due', 'Total Due', 'Status', 'Amount', 'Date', 'Time', 'Collected By'],
            columnAlignments: ['center', 'center', 'left', 'center', 'right', 'right', 'right', 'right', 'right', 'center', 'right', 'center', 'center', 'left'],
            columnWidthWeights: [4, 8, 16, 8, 8, 8, 7, 8, 9, 8, 8, 8, 8, 10],
            totalsRow,
        },
    };
};
