// Mirrors components/reports/ClosedLoanReport.tsx's buildClosedLoanWordOptions(). 41 columns,
// grouped, A3 landscape, no totals row. fetchClosedLoanReport returns the exact same 41
// columns in the exact same order as the client's own builder.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildClosedLoanReportWordExport: WordOptionsBuilder = (headers, rows) => ({
    bodyRows: rows,
    options: {
        groupHeaders: [
            { label: 'S.No', span: 1 }, { label: 'LOCATION', span: 3 }, { label: 'BRANCH & CENTER', span: 4 },
            { label: 'FDO Name', span: 1 }, { label: 'LOAN INFO', span: 2 }, { label: 'MEMBER INFO', span: 2 },
            { label: 'Reason', span: 1 }, { label: 'Funding Name', span: 1 }, { label: 'LOAN DATES', span: 3 },
            { label: 'CLOSURE DATES', span: 3 }, { label: 'Total Tenure', span: 1 }, { label: 'BEFORE CLOSE', span: 3 },
            { label: 'LOAN AMOUNT', span: 3 }, { label: 'WRITEOFF', span: 2 }, { label: 'WAIVER', span: 2 },
            { label: 'PENALTY', span: 2 }, { label: 'Interest %', span: 1 }, { label: 'Next Inst No', span: 1 },
            { label: 'DEATH INFO', span: 3 }, { label: 'Death Certificate', span: 1 }, { label: 'HO Approval Document', span: 1 },
        ],
        subHeaders: ['Region', 'Division', 'Area', 'Branch ID', 'Branch Name', 'Center ID', 'Center Name', 'Loan ID', 'Loan Type', 'Member ID', 'Member Name', 'Disb. Date', '1st EMI Date', 'Maturity Date', 'PreClose', 'Close', 'Last EMI', 'OS Principal', 'OS Interest', 'Waiver Interest', 'Loan Amount', 'Outstanding', 'Interest', 'Principal', 'Interest', 'Principal', 'Interest', 'Amount', 'Paid', 'Is Dead', 'Deceased Type', 'Deceased Name'],
        columnAlignments: ['center', 'left', 'left', 'left', 'center', 'left', 'center', 'left', 'left', 'center', 'left', 'center', 'left', 'left', 'left', 'center', 'center', 'center', 'center', 'center', 'center', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'center', 'left', 'left', 'left', 'left'],
        columnWidthWeights: [3, 6, 6, 6, 6, 10, 6, 10, 9, 7, 9, 7, 12, 10, 9, 7, 7, 7, 7, 7, 7, 6, 7, 7, 7, 7, 7, 6, 7, 7, 7, 7, 7, 7, 6, 6, 6, 9, 9, 10, 10],
        pageSize: { widthMm: 297, heightMm: 420 },
    },
});
