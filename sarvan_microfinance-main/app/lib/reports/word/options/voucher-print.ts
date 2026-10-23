// Mirrors app/dashboard/admin-reports/account/voucher-print/page.tsx's inline `wordOptions`
// (inside handleExportWord). Grouped (Dr/Cr Account pair), 11 columns — fetchVoucherPrint
// returns the same headers/order as the client's own export builder, but unlike the client's
// own rows (which append a trailing TOTAL row before slicing it off), the registry fetch has
// no trailing row at all — so the totals row here is reconstructed by summing the Amount
// column (index 5) across the fetched rows instead of slicing.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildVoucherPrintWordExport: WordOptionsBuilder = (headers, rows) => {
    const totalAmount = rows.reduce((s, r) => s + Number(r[5] ?? 0), 0);
    const totalsRow = ['TOTAL', '', '', '', '', totalAmount, '', '', '', '', ''];

    return {
        bodyRows: rows,
        options: {
            groupHeaders: [
                { label: 'Voucher No', span: 1 }, { label: 'Type', span: 1 }, { label: 'Date', span: 1 },
                { label: 'ACCOUNTS', span: 2 }, { label: 'Amount (₹)', span: 1 }, { label: 'Narration', span: 1 },
                { label: 'Instrument No', span: 1 }, { label: 'Bank Name', span: 1 }, { label: 'Created By', span: 1 },
                { label: 'Branch', span: 1 },
            ],
            subHeaders: ['Dr Account', 'Cr Account'],
            columnAlignments: ['center', 'center', 'center', 'left', 'left', 'right', 'left', 'center', 'left', 'left', 'left'],
            columnWidthWeights: [8, 8, 8, 12, 12, 9, 14, 9, 10, 9, 9],
            totalsRow,
        },
    };
};
