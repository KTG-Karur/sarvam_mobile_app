// Mirrors components/reports/IncentiveReportClient.tsx's buildIncentiveWordOptions().
// That builder derives its grouped header from module-level COLUMNS/HEADER_GROUP_RUNS/
// COLUMN_GROUPS metadata (not a static literal) — reproduced here as the equivalent
// pre-computed groupHeaders/subHeaders/columnAlignments/columnWidthWeights, since
// fetchIncentiveReport returns the exact same 31 columns in the exact same order/grouping
// (officer=6, active=1, gold=9, jlg=3, collection=6, od=5, final=1). No totals row exists
// in the direct export either.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildIncentiveReportWordExport: WordOptionsBuilder = (headers, rows) => ({
    bodyRows: rows,
    options: {
        groupHeaders: [
            { label: 'FIELD OFFICER', span: 6 },
            { label: 'Active Clients', span: 1 },
            { label: 'GOLD LOAN', span: 9 },
            { label: 'JLG LOAN', span: 3 },
            { label: 'COLLECTION INCENTIVE', span: 6 },
            { label: 'OD COLLECTION', span: 5 },
            { label: 'Final Incentive', span: 1 },
        ],
        subHeaders: [
            'Division', 'Branch', 'DOJ', 'Emp ID', 'Staff Name', 'Category',
            'Gold Target', 'Gold Achieved', 'Gold Disb. Amt', 'Achv %', 'Eligible Incentive', 'Wt 0.500-0.640', 'Wt 0.990-1.030', 'Wt 1.050-2.020', 'Weight Incentive',
            'JLG Members', 'JLG Disb. Amt', 'IGP Incentive',
            'Total Demand', 'Demand Coll.', 'Arrear Coll.', 'Total Coll.', 'Recovery %', 'Collection Incentive',
            'OD 31-60', 'OD 61-90', 'OD 91-180', 'OD >180', 'OD Incentive',
        ],
        columnAlignments: ['left', 'left', 'left', 'left', 'left', 'center', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
        columnWidthWeights: [10, 10, 10, 10, 10, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7],
        pageSize: { widthMm: 297, heightMm: 420 },
    },
});
