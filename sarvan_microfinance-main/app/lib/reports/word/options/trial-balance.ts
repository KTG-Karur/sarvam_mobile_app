// Mirrors components/accounts/TrialBalanceClient.tsx's buildTrialBalanceWordOptions().
// Branches on ctx.filters.viewType exactly like the registry's own fetchTrialBalance()
// (report-registry.ts) — 'DETAILED' (9 cols, grouped Opening/Transaction/Closing Dr-Cr
// pairs, genuine grouping) or 'CONDENSED' (5 cols, flat). fetchTrialBalance already
// computes and appends the identical rounded GRAND TOTAL row itself (same formula as the
// client), so it's reused verbatim by slicing it off — no server-side recomputation needed.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildTrialBalanceWordExport: WordOptionsBuilder = (headers, rows, ctx) => {
    const viewType = ctx.filters?.viewType === 'CONDENSED' ? 'CONDENSED' : 'DETAILED';
    const totalsRow = rows[rows.length - 1];
    const bodyRows = rows.slice(0, -1);

    if (viewType === 'DETAILED') {
        return {
            bodyRows,
            options: {
                groupHeaders: [
                    { label: 'S.No', span: 1 },
                    { label: 'Particulars', span: 1 },
                    { label: 'Account Code', span: 1 },
                    { label: 'OPENING', span: 2 },
                    { label: 'TRANSACTION', span: 2 },
                    { label: 'CLOSING', span: 2 },
                ],
                subHeaders: ['Debit', 'Credit', 'Debit', 'Credit', 'Debit', 'Credit'],
                columnAlignments: ['center', 'left', 'center', 'right', 'right', 'right', 'right', 'right', 'right'],
                columnWidthWeights: [4, 20, 8, 10, 10, 10, 10, 10, 10],
                totalsRow,
            },
        };
    }

    return {
        bodyRows,
        options: {
            columnAlignments: ['center', 'left', 'center', 'right', 'right'],
            columnWidthWeights: [4, 30, 10, 14, 14],
            totalsRow,
        },
    };
};
