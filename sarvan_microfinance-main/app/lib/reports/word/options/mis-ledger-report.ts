// Mirrors components/mis-reports/LedgerReportClient.tsx's buildLedgerWordOptions().
// Grouped (Debit/Credit/Balance amount trio), 10 columns — fetchMisLedgerReport
// (report-registry.ts) returns the exact same OPENING BALANCE / data rows / TOTAL /
// CLOSING BALANCE structure and headers (branching on ctx.filters.viewType the same way)
// as the client's own export builder. Only the last (closing balance) row is split off as
// the distinct totalsRow — the TOTAL row stays a normal body row, matching the client.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildMisLedgerReportWordExport: WordOptionsBuilder = (headers, rows) => ({
    bodyRows: rows.slice(0, -1),
    options: {
        groupHeaders: [
            { label: 'S.No', span: 1 }, { label: 'Voucher Date', span: 1 }, { label: 'Branch Name', span: 1 },
            { label: 'Particulars', span: 1 }, { label: 'Narration / Type', span: 1 }, { label: 'Voucher No.', span: 1 },
            { label: 'AMOUNT', span: 3 }, { label: 'Dr/Cr', span: 1 },
        ],
        subHeaders: ['Debit', 'Credit', 'Balance'],
        columnAlignments: ['center', 'center', 'left', 'left', 'left', 'center', 'right', 'right', 'right', 'center'],
        columnWidthWeights: [4, 8, 10, 14, 12, 8, 8, 8, 8, 6],
        totalsRow: rows[rows.length - 1],
    },
});
