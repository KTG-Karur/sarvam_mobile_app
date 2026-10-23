// Mirrors components/reports/DeathMemberReport.tsx's buildDeathMemberWordOptions(). 35
// columns, grouped, A3 landscape. fetchDeathMember returns the exact same 35 columns in the
// exact same order as the client's own builder, but does not append a totals row — reconstructed
// here by summing Loan Principal/Interest/Amount, OS Principal/Interest/Total, and Arrear
// Principal/Interest/Total (indices 23-31) across the fetched rows.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildDeathMemberWordExport: WordOptionsBuilder = (headers, rows) => {
    const sum = (colIndex: number) => rows.reduce((s, r) => s + Number(r[colIndex] ?? 0), 0);
    const totalsRow = [
        `Totals (${rows.length} records)`, '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '',
        sum(23), sum(24), sum(25), sum(26), sum(27), sum(28), sum(29), sum(30), sum(31),
        '', '', '',
    ];

    return {
        bodyRows: rows,
        options: {
            groupHeaders: [
                { label: 'S.No', span: 1 }, { label: 'LOCATION', span: 3 }, { label: 'BRANCH & CENTER', span: 4 },
                { label: 'FDO Name', span: 1 }, { label: 'Date of Death', span: 1 }, { label: 'Death Person', span: 1 },
                { label: 'Product Type', span: 1 }, { label: 'Loan ID', span: 1 }, { label: 'MEMBER INFO', span: 7 },
                { label: 'LOAN DATES', span: 3 }, { label: 'LOAN AMOUNT', span: 3 }, { label: 'OUTSTANDING', span: 3 },
                { label: 'ARREAR', span: 3 }, { label: 'Interest Rate (%)', span: 1 }, { label: 'Funding Name', span: 1 },
                { label: 'Death Certificate', span: 1 },
            ],
            subHeaders: ['Region', 'Division', 'Area', 'Branch ID', 'Branch Name', 'Center ID', 'Center Name', 'Member ID', 'Member Name', 'Nominee Name', 'Address', 'District', 'Phone', 'Aadhaar', 'Disb. Date', '1st EMI Date', 'Maturity Date', 'Principal', 'Interest', 'Total', 'Principal', 'Interest', 'Total', 'Principal', 'Interest', 'Total'],
            columnAlignments: ['center', 'left', 'left', 'left', 'center', 'left', 'center', 'left', 'left', 'center', 'left', 'left', 'center', 'center', 'left', 'left', 'left', 'left', 'center', 'center', 'center', 'center', 'center', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'left', 'left'],
            columnWidthWeights: [3, 6, 6, 6, 6, 10, 6, 10, 9, 7, 8, 8, 7, 7, 12, 10, 10, 7, 7, 8, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 9, 10],
            totalsRow,
            pageSize: { widthMm: 297, heightMm: 420 },
        },
    };
};
