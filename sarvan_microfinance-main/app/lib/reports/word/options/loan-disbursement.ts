// Mirrors app/dashboard/reports/portfolio/loan-disbursement/page.tsx's
// buildLoanDisbursementWordOptions(). Grouped, A3 landscape, 40 columns — the group/sub
// header labels and column alignments/widths are static layout config reused verbatim
// (fetchLoanDisbursement returns the exact same 40 columns in the exact same order as the
// client's own export builder). totalsRow is reconstructed by summing the Loan Principal /
// Loan Interest / Loan Total Amount columns (indices 31/32/33) across the fetched rows.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildLoanDisbursementWordExport: WordOptionsBuilder = (headers, rows) => {
    const sum = (colIndex: number) => rows.reduce((s, r) => s + Number(r[colIndex] ?? 0), 0);
    const totalsRow = new Array(headers.length).fill('');
    totalsRow[1] = `GRAND TOTAL (${rows.length} loans)`;
    totalsRow[31] = sum(31);
    totalsRow[32] = sum(32);
    totalsRow[33] = sum(33);

    return {
        bodyRows: rows,
        options: {
            groupHeaders: [
                { label: 'S.No.', span: 1 }, { label: 'LOCATION', span: 3 }, { label: 'BRANCH & CENTER', span: 4 },
                { label: 'PRODUCT', span: 2 }, { label: 'Loan ID', span: 1 }, { label: 'MEMBER INFO', span: 4 },
                { label: 'Loan Cycle', span: 1 }, { label: 'FDO Name', span: 1 }, { label: 'Purpose Of Loan', span: 1 },
                { label: 'Loan Index ID', span: 1 }, { label: 'DISBURSEMENT', span: 2 }, { label: 'LOAN PERIOD', span: 2 },
                { label: 'FEES', span: 4 }, { label: 'Insurance Fee', span: 1 }, { label: 'Installment Type', span: 1 },
                { label: 'Number Of Installments', span: 1 }, { label: 'Rate Of Interest', span: 1 },
                { label: 'LOAN AMOUNT', span: 3 }, { label: 'GOLD', span: 2 }, { label: 'Funding Name', span: 1 },
                { label: 'STATUS', span: 3 },
            ],
            subHeaders: ['Region', 'Division', 'Area', 'Branch ID', 'Branch Name', 'Centre ID', 'Center Name', 'Type', 'Loan Product', 'Member ID', 'Member Name', 'Aadhaar', 'Phone', 'Date', 'Time', 'Start Date', 'End Date', 'Admission', 'Processing', 'CGST', 'SGST', 'Principal', 'Interest', 'Total', 'Weight', 'Value', 'Loan Status', 'Approval', 'Center Transfer'],
            columnAlignments: ['center', 'left', 'left', 'left', 'center', 'left', 'center', 'left', 'left', 'left', 'center', 'center', 'left', 'center', 'center', 'center', 'left', 'left', 'center', 'center', 'center', 'center', 'center', 'right', 'right', 'right', 'right', 'right', 'center', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'left', 'center', 'center', 'center'],
            columnWidthWeights: [3, 6, 6, 6, 6, 10, 6, 10, 8, 10, 7, 7, 14, 8, 8, 6, 9, 12, 7, 7, 6, 7, 7, 7, 7, 6, 6, 7, 7, 7, 7, 7, 7, 8, 7, 9, 9, 7, 7, 8],
            totalsRow,
            pageSize: { widthMm: 297, heightMm: 420 },
        },
    };
};
