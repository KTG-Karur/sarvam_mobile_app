// Mirrors components/reports/DenominationCollectionReportClient.tsx's
// buildDenominationWordOptions(). Grouped (Date | DENOMINATIONS x6 | Total), 8 columns —
// fetchDenominationCollection returns the exact same 8 columns in the exact same order as
// the client's own export builder. totalsRow is reconstructed by summing the 6 denomination
// columns (indices 1-6) plus Total (index 7) across the fetched rows.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

const DENOM_LABELS = ['₹500', '₹100', '₹50', '₹20', '₹10', 'Coins'];

export const buildDenominationCollectionWordExport: WordOptionsBuilder = (headers, rows) => {
    const sum = (colIndex: number) => rows.reduce((s, r) => s + Number(r[colIndex] ?? 0), 0);
    const totalsRow: (string | number)[] = ['TOTAL', sum(1), sum(2), sum(3), sum(4), sum(5), sum(6), sum(7)];

    return {
        bodyRows: rows,
        options: {
            groupHeaders: [
                { label: 'Date', span: 1 },
                { label: 'DENOMINATIONS', span: DENOM_LABELS.length },
                { label: 'Total', span: 1 },
            ],
            subHeaders: DENOM_LABELS,
            columnAlignments: ['center', ...DENOM_LABELS.map(() => 'right' as const), 'right'],
            columnWidthWeights: [10, ...DENOM_LABELS.map(() => 8), 9],
            totalsRow,
        },
    };
};
