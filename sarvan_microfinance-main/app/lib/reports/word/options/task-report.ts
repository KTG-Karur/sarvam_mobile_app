// Mirrors components/reports/TaskReportClient.tsx's buildTaskReportWordOptions(). Grouped,
// A3 landscape, 30 columns — fetchTaskReport (report-registry.ts) builds its headers as
// ['Level', ...Object.keys(taskRowToObj(...))], which is the exact same 30 columns in the
// exact same order as the client's own buildTaskReportExportRows(), and always ends with an
// ['Overall Summary', ...] row matching the client's trailing totals row.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildTaskReportWordExport: WordOptionsBuilder = (headers, rows) => ({
    bodyRows: rows.slice(0, -1),
    options: {
        groupHeaders: [
            { label: 'Level', span: 1 }, { label: 'Employee ID', span: 1 }, { label: 'Name', span: 1 }, { label: 'Branch', span: 1 },
            { label: 'TARGETS', span: 4 }, { label: 'ACHIEVED', span: 5 }, { label: 'COLLECTION %', span: 3 },
            { label: 'No. Centers', span: 1 }, { label: 'ACTIVE', span: 3 }, { label: 'Disbmt Members', span: 1 },
            { label: 'GOLD', span: 3 }, { label: 'PORTFOLIO', span: 2 }, { label: 'ARREAR', span: 4 },
        ],
        subHeaders: [
            'Enrollment', 'New Member', 'Renewal', 'Disbursement (₹)',
            'Enrollment', 'Balance', 'New Member', 'Renewal', 'Disbursement (₹)',
            'Target', 'Actual', 'Diff',
            'Total', 'Members', 'Clients',
            'Members', 'Amount (₹)', 'Returns',
            'Principal (₹)', 'Interest (₹)',
            'Clients', 'Principal (₹)', 'Interest (₹)', 'Member %',
        ],
        columnAlignments: ['left', 'center', 'left', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
        columnWidthWeights: [7, 7, 10, 9, 7, 8, 7, 8, 7, 6, 8, 7, 8, 7, 6, 6, 6, 6, 6, 7, 7, 6, 7, 7, 7, 8, 8, 8, 7, 7],
        totalsRow: rows[rows.length - 1] as (string | number)[],
        pageSize: { widthMm: 297, heightMm: 420 },
    },
});
