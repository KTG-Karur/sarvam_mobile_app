// Mirrors components/reports/ApplicationFormReport.tsx's `wordOptions` literal. 62 columns —
// the widest report in the app — grouped, A3 landscape, no totals row (a KYC/application
// dump, not a financial roll-up). fetchApplicationForm returns the exact same 62 columns in
// the exact same order as the client's own prepareExcelData()-derived headers, so the
// group/sub header labels and column alignments/widths are reused verbatim.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildApplicationFormWordExport: WordOptionsBuilder = (headers, rows) => ({
    bodyRows: rows,
    options: {
        groupHeaders: [
            { label: 'Client Account Number', span: 1 }, { label: 'BRANCH & CENTER', span: 3 },
            { label: 'IDENTITY', span: 3 }, { label: 'NOMINEE', span: 2 }, { label: 'PARENTS', span: 2 },
            { label: 'SPOUSE', span: 3 }, { label: 'Age', span: 1 }, { label: 'Gender', span: 1 },
            { label: 'Marital Status', span: 1 }, { label: 'Date of Joining', span: 1 }, { label: 'Permanent Address', span: 1 },
            { label: 'PHONE', span: 2 }, { label: 'ID DOCS', span: 3 }, { label: 'Unique ID (Aadhar Masked)', span: 1 },
            { label: 'NOMINEE ID', span: 3 }, { label: 'NOMINEE DETAILS', span: 3 }, { label: 'Qualification', span: 1 },
            { label: 'Occupation', span: 1 }, { label: 'ECONOMIC ACTIVITY', span: 2 }, { label: 'SPOUSE ECONOMIC ACTIVITY', span: 2 },
            { label: 'INCOME', span: 2 }, { label: 'LOAN REQUEST', span: 3 }, { label: 'LOAN PRODUCT', span: 3 },
            { label: 'House Status', span: 1 }, { label: 'BANK DETAILS', span: 5 }, { label: 'CO-APPLICANT', span: 8 },
            { label: 'Religion', span: 1 }, { label: 'Caste', span: 1 }, { label: 'Purpose of Loan', span: 1 },
        ],
        subHeaders: ['Branch', 'Center', 'Center Code', 'Name', 'Member/Client', 'ID', 'Nominee', 'Relation', 'Father Name', 'Mother Name', 'Name', 'DOB', 'Gender', 'Phone 1', 'Phone 2', 'Voter ID', 'PAN Card', 'Smart Card No', 'UID (Masked)', 'VID', 'PAN', 'DOB', 'Age', 'Gender', 'Type', 'Activity', 'Type', 'Activity', 'Monthly Income', 'Monthly Expense', 'Amount', 'Tenure (Weeks)', 'Frequency', 'Type', 'Product', 'Amount', 'A/c No', 'A/c Type', 'Bank Name', 'Branch', 'IFSC', 'Name', 'Age', 'Relation', 'Phone', 'DOB', 'Gender', 'Eco. Type', 'Eco. Activity'],
        columnAlignments: ['center', 'left', 'left', 'center', 'left', 'center', 'center', 'left', 'left', 'left', 'left', 'left', 'center', 'center', 'center', 'center', 'center', 'center', 'left', 'center', 'center', 'center', 'center', 'center', 'center', 'center', 'center', 'center', 'center', 'center', 'center', 'left', 'left', 'left', 'left', 'left', 'left', 'right', 'right', 'right', 'right', 'center', 'left', 'left', 'right', 'center', 'center', 'center', 'left', 'left', 'center', 'left', 'center', 'left', 'center', 'center', 'center', 'left', 'left'],
        columnWidthWeights: [8, 9, 9, 7, 12, 8, 8, 10, 8, 10, 10, 10, 7, 6, 4, 6, 7, 8, 16, 8, 8, 8, 8, 8, 9, 9, 8, 8, 7, 5, 6, 8, 8, 9, 9, 9, 9, 8, 8, 8, 7, 7, 8, 9, 7, 7, 9, 7, 9, 8, 8, 10, 5, 8, 8, 7, 6, 8, 8, 7, 7, 10],
        pageSize: { widthMm: 297, heightMm: 420 },
    },
});
