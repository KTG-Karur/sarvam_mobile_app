// Mirrors components/reports/LoanScheduleReport.tsx's buildScheduleWordOptions(). Flat,
// no grouping — fetchLoanSchedule (report-registry.ts) already returns the exact same 8
// columns in the same order, including its own leading 6-row loan-info block and a trailing
// 'Grand Total' row identical in shape to the client's buildScheduleExportRows(). Reused
// verbatim: no need to recompute totals, the registry fetch already appends the same row.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildLoanScheduleWordExport: WordOptionsBuilder = (headers, rows) => {
    const hasTotals = rows.length > 0 && rows[rows.length - 1][0] === 'Grand Total';
    // fetchLoanSchedule (report-registry.ts) drops the two "Loan Advance Due/Paid"
    // columns entirely when the feature is disabled — detect that from the header
    // count rather than hardcoding 8, so alignments/widths stay in sync with `rows`.
    const loanAdvanceEnabled = headers.length === 8;
    return {
        bodyRows: hasTotals ? rows.slice(0, -1) : rows,
        options: {
            columnAlignments: loanAdvanceEnabled
                ? ['center', 'center', 'right', 'right', 'right', 'right', 'right', 'right']
                : ['center', 'center', 'right', 'right', 'right', 'right'],
            columnWidthWeights: loanAdvanceEnabled
                ? [6, 10, 9, 9, 10, 10, 9, 9]
                : [7, 12, 11, 11, 12, 12],
            totalsRow: hasTotals ? (rows[rows.length - 1] as (string | number)[]) : undefined,
        },
    };
};
