// Mirrors components/reports/LoanAdvanceLedgerReport.tsx's buildLoanAdvanceWordOptions().
// Grouped (CLIENT SUMMARY | TRANSACTION), 13 columns, one row per transaction (client-summary
// cells blank on continuation rows) — fetchLoanAdvanceLedger returns the exact same 13
// columns in the exact same order, and already appends the identical inline 'GRAND TOTAL'
// row the client computes, so no server-side total reconstruction is needed here — it's
// simply sliced off the already-fetched rows, same as the client does.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildLoanAdvanceLedgerWordExport: WordOptionsBuilder = (headers, rows) => {
    const hasTotals = rows.length > 0 && rows[rows.length - 1][0] === 'GRAND TOTAL';
    return {
        bodyRows: hasTotals ? rows.slice(0, -1) : rows,
        options: {
            groupHeaders: [
                { label: 'CLIENT SUMMARY', span: 6 },
                { label: 'TRANSACTION', span: 7 },
            ],
            subHeaders: ['Client ID', 'Client Name', 'Center', 'Current Balance', 'Total Collected', 'Total Refunded', 'Tx Date', 'Tx ID', 'Type', 'Loan A/c', 'Amount', 'Mode', 'Status'],
            columnAlignments: ['center', 'left', 'left', 'right', 'right', 'right', 'center', 'center', 'center', 'center', 'right', 'center', 'center'],
            columnWidthWeights: [7, 12, 12, 9, 9, 9, 8, 8, 7, 8, 8, 7, 8],
            totalsRow: hasTotals ? rows[rows.length - 1] : undefined,
        },
    };
};
