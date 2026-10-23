// Mirrors app/dashboard/admin-reports/account/receipts-payments/page.tsx's
// buildReceiptsPaymentsWordOptions(). Grouped (RECEIPTS/PAYMENTS side-by-side), trailing
// TOTAL RECEIPTS/TOTAL PAYMENTS row split off as the distinct totals row — fetchReceiptsPayments
// returns the exact same 4 columns/order/trailing-row shape as the client's own export builder.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildReceiptsPaymentsWordExport: WordOptionsBuilder = (headers, rows) => ({
    bodyRows: rows.slice(0, -1),
    options: {
        groupHeaders: [
            { label: 'RECEIPTS', span: 2 },
            { label: 'PAYMENTS', span: 2 },
        ],
        subHeaders: ['Ledger Name', 'Amount (₹)', 'Ledger Name', 'Amount (₹)'],
        columnAlignments: ['left', 'right', 'left', 'right'],
        columnWidthWeights: [16, 10, 16, 10],
        totalsRow: rows[rows.length - 1],
    },
});
