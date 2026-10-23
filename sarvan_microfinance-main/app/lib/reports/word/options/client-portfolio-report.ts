// Mirrors components/reports/ClientPortfolioReport.tsx's buildPortfolioWordOptions(). 35
// columns, grouped, A3 landscape. fetchClientPortfolioReport already appends the exact same
// GRAND TOTAL row (same sum computation, same column positions) that the client's own
// buildPortfolioExportRows() does, so it's simply sliced off here rather than recomputed.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildClientPortfolioReportWordExport: WordOptionsBuilder = (headers, rows) => ({
    bodyRows: rows.slice(0, -1),
    options: {
        groupHeaders: [
            { label: 'S.No', span: 1 }, { label: 'LOCATION', span: 3 }, { label: 'BRANCH & CENTER', span: 4 },
            { label: 'FDO Name', span: 1 }, { label: 'Product Type', span: 1 }, { label: 'Loan ID', span: 1 },
            { label: 'MEMBER INFO', span: 7 }, { label: 'LOAN DATES', span: 3 }, { label: 'LOAN AMOUNT', span: 3 },
            { label: 'OUTSTANDING', span: 3 }, { label: 'ARREAR', span: 3 }, { label: 'Interest Rate (%)', span: 1 },
            { label: 'Funding Name', span: 1 }, { label: 'DEATH INFO', span: 3 },
        ],
        subHeaders: ['Region', 'Division', 'Area', 'Branch ID', 'Branch Name', 'Centre ID', 'Center Name', 'Member ID', 'Member Name', 'Nominee Name', 'Address', 'District', 'Phone', 'Aadhaar', 'Disb. Date', '1st EMI Date', 'Maturity Date', 'Principal', 'Interest', 'Total', 'Principal', 'Interest', 'Total', 'Principal', 'Interest', 'Total', 'Is Dead', 'Deceased Type', 'Deceased Name'],
        columnAlignments: ['center', 'left', 'left', 'left', 'center', 'left', 'center', 'left', 'left', 'left', 'center', 'center', 'left', 'left', 'left', 'left', 'center', 'center', 'center', 'center', 'center', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'left', 'center', 'left', 'left'],
        columnWidthWeights: [3, 6, 6, 6, 6, 10, 6, 10, 9, 8, 7, 7, 12, 10, 10, 7, 7, 8, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 9, 6, 9, 9],
        totalsRow: rows[rows.length - 1],
        pageSize: { widthMm: 297, heightMm: 420 },
    },
});
