// Mirrors components/reports/DCBClient.tsx's buildDCBWordOptions(). 32 columns, grouped, A3
// landscape. fetchDcb returns the exact same 32 columns in the exact same order as the
// client's own builder — and, unlike the client's own buildDCBExportRows(), does NOT append
// a totals row at all (no pre-existing WriteOff-columns-mismatch to inherit), so the totals
// row here is computed fresh from the fetched rows: straightforward per-column sums for the
// numeric fields, and a plain average for RR % (index 31). `.slice(0, headers.length)` is
// kept as a defensive no-op, matching the same safety net the client's own builder uses.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildDcbWordExport: WordOptionsBuilder = (headers, rows) => {
    const sum = (colIndex: number) => rows.reduce((s, r) => s + Number(r[colIndex] ?? 0), 0);
    const avg = (colIndex: number) => (rows.length > 0 ? sum(colIndex) / rows.length : 0);

    const oap = sum(6), oai = sum(7);
    const dp = sum(9), di = sum(10);

    const totalsRow = [
        'GRAND TOTAL', '', '', '', '', '',
        oap, oai, oap + oai,
        dp, di, dp + di,
        oap + dp, oai + di, oap + dp + oai + di,
        sum(15), sum(16),
        sum(17), sum(18),
        sum(19), sum(20),
        sum(21), sum(22),
        sum(23), sum(24),
        sum(25), sum(26),
        sum(27), sum(28),
        sum(29), sum(30),
        Number(avg(31).toFixed(2)),
    ].slice(0, headers.length);

    return {
        bodyRows: rows,
        options: {
            groupHeaders: [
                { label: 'Branch ID', span: 1 }, { label: 'Branch Name', span: 1 }, { label: 'Date', span: 1 },
                { label: 'Center ID', span: 1 }, { label: 'Center Name', span: 1 }, { label: 'FDO Name', span: 1 },
                { label: 'OPENING ARREAR', span: 3 }, { label: 'CURRENT DEMAND', span: 3 }, { label: 'TOTAL DEMAND', span: 3 },
                { label: 'ARREAR COLLECTED', span: 2 }, { label: 'CURR DEMAND COLLECTED', span: 2 },
                { label: 'ADVANCE COLLECTED', span: 2 }, { label: 'PRECLOSURE', span: 2 }, { label: 'OD ARREAR COLLECTED', span: 2 },
                { label: 'TOTAL COLLECTED', span: 2 }, { label: 'CURRENT ARREAR', span: 2 }, { label: 'CLOSING ARREAR', span: 2 },
                { label: 'RR %', span: 1 },
            ],
            subHeaders: ['Principal', 'Interest', 'Total', 'Principal', 'Interest', 'Total', 'Principal', 'Interest', 'Total', 'Principal', 'Interest', 'Principal', 'Interest', 'Principal', 'Interest', 'Principal', 'Interest', 'Principal', 'Interest', 'Principal', 'Interest', 'Principal', 'Interest', 'Principal', 'Interest'],
            columnAlignments: ['center', 'left', 'center', 'center', 'left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
            columnWidthWeights: [6, 9, 7, 6, 9, 8, 7, 7, 7, 7, 7, 7, 7, 7, 7, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6],
            totalsRow,
            pageSize: { widthMm: 297, heightMm: 420 },
        },
    };
};
