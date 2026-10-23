// Mirrors components/reports/DCRClient.tsx's buildDCRWordOptions(). Column count is dynamic
// (4 columns per active funder) — fetchDcr builds its headers with the exact same
// `funders.flatMap(f => [...])` pattern as the client, so the funder count and names are
// derived directly from the fetched `headers` array (no separate funders list needed):
// headers[5 + i*4] is always "<Funder Name> - Principal" for the i-th funder (5 leading
// non-funder columns + 6 trailing non-funder columns = 11, so funderCount = (headers.length - 11) / 4).
// Since the Batch 2 shared-fetch fix, fetchDcr now appends its own trailing "Grand Total" row
// too — reused directly here (split off the body, reused as-is) rather than re-summed, since
// re-summing over `rows` would double-count that trailing row's own values into the sum.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildDcrWordExport: WordOptionsBuilder = (headers, rows) => {
    // fetchDcr (report-registry.ts) drops the trailing "Loan Advance" column
    // entirely when the feature is disabled — 8 fixed non-funder columns then,
    // 9 when enabled (5 leading + Total Principal + Total Interest + Loan
    // Advance + Total Amount).
    const loanAdvanceEnabled = headers.includes('Loan Advance');
    const fixedTrailingCols = loanAdvanceEnabled ? 9 : 8;
    const funderCount = Math.max(0, Math.round((headers.length - fixedTrailingCols) / 2));
    const funderNames = Array.from({ length: funderCount }, (_, i) => {
        const h = String(headers[5 + i * 2] ?? '');
        return h.replace(/ - Principal$/, '');
    });

    const hasTotals = rows.length > 0 && rows[rows.length - 1][0] === 'Grand Total';
    const bodyRows = hasTotals ? rows.slice(0, -1) : rows;
    const totalsRow = hasTotals ? (rows[rows.length - 1] as (string | number)[]) : undefined;

    const funderGroups = funderNames.map((name) => ({ label: name.toUpperCase(), span: 2 }));
    const funderSubHeaders = funderNames.flatMap(() => ['Principal', 'Interest']);
    const funderAlignments = funderNames.flatMap((): ('left' | 'center' | 'right')[] => ['right', 'right']);
    const funderWidths = funderNames.flatMap(() => [7, 7]);

    return {
        bodyRows,
        options: {
            groupHeaders: [
                { label: 'Center ID', span: 1 }, { label: 'Center Name', span: 1 },
                { label: 'Admin Fees', span: 1 }, { label: 'Doc. Charges', span: 1 }, { label: 'Ins. Fees', span: 1 },
                ...funderGroups,
                { label: 'TOTALS', span: 2 },
                ...(loanAdvanceEnabled ? [{ label: 'Loan Advance', span: 1 }] : []), { label: 'Total Amount', span: 1 },
            ],
            subHeaders: [...funderSubHeaders, 'Principal', 'Interest'],
            columnAlignments: [
                'center', 'left', 'right', 'right', 'right', ...funderAlignments, 'right', 'right',
                ...(loanAdvanceEnabled ? (['right'] as const) : []), 'right',
            ],
            columnWidthWeights: [6, 10, 7, 7, 7, ...funderWidths, 7, 7, ...(loanAdvanceEnabled ? [8] : []), 9],
            totalsRow,
            pageSize: headers.length > 20 ? { widthMm: 297, heightMm: 420 } : undefined,
        },
    };
};
