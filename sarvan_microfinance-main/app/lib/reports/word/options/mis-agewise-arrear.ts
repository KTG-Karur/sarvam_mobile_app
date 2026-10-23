// Mirrors components/mis-reports/AgewiseArrearClient.tsx's buildAgewiseArrearWordOptions().
// Branches on ctx.filters.reportType exactly like the registry's own fetchMisAgewiseArrear()
// (report-registry.ts), which already computes and appends the identical grand-total row for
// each of the 5 modes (BRANCHWISE/CENTERWISE/FDOWISE/CLIENTWISE/DETAILEDWISE) — reused
// verbatim by slicing it off, no server-side recomputation needed. Layout config is static
// per mode and reused verbatim.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

const ageingSub = ['1-30', '31-60', '61-90', '91-180', '>180'];
const arrearSub = ['Principal', 'Interest', 'Total'];

export const buildMisAgewiseArrearWordExport: WordOptionsBuilder = (headers, rows, ctx) => {
    const reportType = ctx.filters?.reportType;
    const bodyRows = rows.slice(0, -1);
    const totalsRow = rows[rows.length - 1];

    if (reportType === 'BRANCHWISE') {
        return {
            bodyRows,
            options: {
                groupHeaders: [
                    { label: 'Branch', span: 1 }, { label: '# Centers', span: 1 }, { label: '# Clients', span: 1 },
                    { label: 'Loan Amount', span: 1 }, { label: 'Pri. Balance', span: 1 },
                    { label: 'AGEING', span: 5 }, { label: 'ARREAR', span: 3 },
                ],
                subHeaders: [...ageingSub, ...arrearSub],
                columnAlignments: ['left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
                columnWidthWeights: [14, 8, 8, 9, 9, 6, 6, 6, 6, 6, 7, 7, 7],
                totalsRow,
            },
        };
    }
    if (reportType === 'CENTERWISE') {
        return {
            bodyRows,
            options: {
                groupHeaders: [
                    { label: 'Branch', span: 1 }, { label: 'Center', span: 1 }, { label: '# Clients', span: 1 },
                    { label: 'Loan Amount', span: 1 }, { label: 'Pri. Balance', span: 1 },
                    { label: 'AGEING', span: 5 }, { label: 'ARREAR', span: 3 },
                ],
                subHeaders: [...ageingSub, ...arrearSub],
                columnAlignments: ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
                columnWidthWeights: [12, 12, 8, 9, 9, 6, 6, 6, 6, 6, 7, 7, 7],
                totalsRow,
            },
        };
    }
    if (reportType === 'FDOWISE') {
        return {
            bodyRows,
            options: {
                groupHeaders: [
                    { label: 'Branch', span: 1 }, { label: 'FDO', span: 1 }, { label: '# Centers', span: 1 },
                    { label: '# Clients', span: 1 }, { label: 'Loan Amount', span: 1 }, { label: 'Pri. Balance', span: 1 },
                    { label: 'AGEING', span: 5 }, { label: 'ARREAR', span: 3 },
                ],
                subHeaders: [...ageingSub, ...arrearSub],
                columnAlignments: ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
                columnWidthWeights: [11, 11, 7, 7, 8, 8, 6, 6, 6, 6, 6, 7, 7, 7],
                totalsRow,
            },
        };
    }
    if (reportType === 'CLIENTWISE') {
        return {
            bodyRows,
            options: {
                groupHeaders: [
                    { label: 'Branch', span: 1 }, { label: 'Center', span: 1 }, { label: 'Client', span: 1 },
                    { label: 'Phone', span: 1 }, { label: 'Loan A/C', span: 1 }, { label: 'Loan Amount', span: 1 },
                    { label: 'Pri. Balance', span: 1 }, { label: 'Total Dues', span: 1 }, { label: 'Disbursal Date', span: 1 },
                    { label: 'AGEING', span: 5 }, { label: 'ARREAR', span: 3 }, { label: 'FDO', span: 1 },
                ],
                subHeaders: [...ageingSub, ...arrearSub],
                columnAlignments: ['left', 'left', 'left', 'center', 'center', 'right', 'right', 'right', 'center', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'left'],
                columnWidthWeights: [9, 9, 11, 7, 7, 7, 7, 7, 7, 5, 5, 5, 5, 5, 6, 6, 6, 8],
                totalsRow,
            },
        };
    }
    // DETAILEDWISE — same shape as Portfolio at Risk, minus its PAR% column.
    return {
        bodyRows,
        options: {
            groupHeaders: [
                { label: 'S.No', span: 1 }, { label: 'BRANCH & CENTER', span: 4 }, { label: 'Product Type', span: 1 },
                { label: 'Loan ID', span: 1 }, { label: 'LOAN DATES', span: 3 }, { label: 'MEMBER INFO', span: 6 },
                { label: 'Loan Amount', span: 1 }, { label: 'No of Installment', span: 1 }, { label: 'REPAYMENT', span: 2 },
                { label: 'DUES', span: 2 }, { label: 'Loan Age', span: 1 }, { label: 'Age Wise', span: 1 },
                { label: 'DueDay', span: 1 }, { label: 'EMI', span: 1 }, { label: 'LOAN AMOUNT', span: 3 },
                { label: 'OUTSTANDING', span: 3 }, { label: 'OVERDUE', span: 3 }, { label: 'OPENING OD', span: 3 },
                { label: 'CURRENT COLLECTION', span: 3 }, { label: 'COLLECTION', span: 2 }, { label: 'CLOSING OD', span: 3 },
                { label: 'Funder', span: 1 }, { label: 'FDO Name', span: 1 },
            ],
            subHeaders: ['Branch ID', 'Branch', 'Centre ID', 'Center', 'Disb. Date', '1st EMI Date', 'Maturity Date', 'Member ID', 'Member Name', 'Nominee Name', 'Address', 'District', 'Phone', 'Last Date', 'Last Amount', 'Collected', 'Left', 'Principal', 'Interest', 'Total', 'Principal', 'Interest', 'Total', 'Principal', 'Interest', 'Total', 'Principal', 'Interest', 'Total', 'Principal', 'Interest', 'Total', 'Principal', 'Interest', 'Principal', 'Interest', 'Total'],
            columnAlignments: ['center', 'center', 'left', 'center', 'left', 'left', 'center', 'center', 'center', 'center', 'center', 'left', 'left', 'left', 'left', 'center', 'right', 'right', 'center', 'right', 'right', 'right', 'right', 'center', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'left', 'left'],
            columnWidthWeights: [3, 6, 9, 6, 9, 8, 7, 7, 7, 7, 7, 11, 10, 10, 7, 7, 7, 6, 7, 7, 7, 7, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 8, 8],
            totalsRow,
            pageSize: { widthMm: 297, heightMm: 420 },
        },
    };
};
