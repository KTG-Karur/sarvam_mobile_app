// Mirrors app/dashboard/reports/portfolio/os-centerwise/page.tsx's
// buildOSCenterwiseWordOptions(). Grouped (OS/Arrear pairs), 8 columns — fetchOSCenterwise
// returns the exact same 8 columns in the exact same order as the client's own export
// builder, and (since the Batch 1 shared-fetch fix) now appends its own trailing "TOTAL" row
// too — reused directly here (split off the body, reused as-is) rather than re-summed, since
// re-summing over `rows` would double-count that trailing row's own values into the sum.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildOsCenterwiseWordExport: WordOptionsBuilder = (headers, rows) => {
    const hasTotals = rows.length > 0 && rows[rows.length - 1][0] === 'TOTAL';
    const bodyRows = hasTotals ? rows.slice(0, -1) : rows;
    const totalsRow = hasTotals ? (rows[rows.length - 1] as (string | number)[]) : undefined;

    return {
        bodyRows,
        options: {
            groupHeaders: [
                { label: 'Branch Name', span: 1 },
                { label: 'Center Name', span: 1 },
                { label: 'No. of Clients', span: 1 },
                { label: 'OS', span: 2 },
                { label: 'ARREAR', span: 3 },
            ],
            subHeaders: ['Principal', 'Interest', 'Clients', 'Principal', 'Interest'],
            columnAlignments: ['left', 'left', 'right', 'right', 'right', 'right', 'right', 'right'],
            columnWidthWeights: [14, 14, 8, 8, 8, 8, 8, 8],
            totalsRow,
        },
    };
};
