// Mirrors components/reports/PayslipClient.tsx's buildPayslipWordOptions(). Single-record
// form (Field/Value pairs), not a record grid — no grouped headers. fetchPayslip
// (report-registry.ts) already reconstructs the exact same 5-column layout (Field, Value, '',
// Field, Value) with the same EARNINGS/DEDUCTIONS sub-header row, item rows, Total
// Earnings/Deductions row, and a trailing NET SALARY PAYABLE row — so the same
// rows.slice(-1)/rows[last] totals split works unchanged.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildPayslipWordExport: WordOptionsBuilder = (headers, rows) => ({
    bodyRows: rows.slice(0, -1),
    options: {
        columnAlignments: ['left', 'right', 'center', 'left', 'right'],
        columnWidthWeights: [7, 5, 1, 7, 5],
        totalsRow: rows[rows.length - 1] as (string | number)[],
    },
});
