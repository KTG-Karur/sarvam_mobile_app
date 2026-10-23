// Mirrors app/dashboard/admin-reports/portfolio/os-branchwise/page.tsx's
// buildOSBranchwiseWordOptions(). Grouped (OS/ARREAR clusters), 10 columns —
// fetchOSBranchwise returns the same headers/order as the client's own export builder, but
// (unlike the client) has no trailing GRAND TOTAL row, so it's reconstructed by summing the
// numeric columns.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildOsBranchwiseWordExport: WordOptionsBuilder = (headers, rows) => {
    // fetchOSBranchwise (report-registry.ts) drops the two "OS/Arrear Loan Advance"
    // columns entirely when the feature is disabled — detect that from the header
    // count (10 with, 8 without) rather than hardcoding, so this stays in sync.
    const loanAdvanceEnabled = headers.length === 10;
    const sum = (colIndex: number) => rows.reduce((s, r) => s + Number(r[colIndex] ?? 0), 0);
    const totalsRow = loanAdvanceEnabled
        ? ['', 'GRAND TOTAL', sum(2), sum(3), sum(4), sum(5), sum(6), sum(7), sum(8), sum(9)]
        : ['', 'GRAND TOTAL', sum(2), sum(3), sum(4), sum(5), sum(6), sum(7)];

    return {
        bodyRows: rows,
        options: {
            groupHeaders: [
                { label: 'Branch Code', span: 1 }, { label: 'Branch Name', span: 1 }, { label: 'No. of Clients', span: 1 },
                { label: 'OS', span: loanAdvanceEnabled ? 3 : 2 }, { label: 'ARREAR', span: loanAdvanceEnabled ? 4 : 3 },
            ],
            subHeaders: loanAdvanceEnabled
                ? ['Principal', 'Interest', 'Loan Advance', 'Clients', 'Principal', 'Interest', 'Loan Advance']
                : ['Principal', 'Interest', 'Clients', 'Principal', 'Interest'],
            columnAlignments: loanAdvanceEnabled
                ? ['center', 'left', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right']
                : ['center', 'left', 'right', 'right', 'right', 'right', 'right', 'right'],
            columnWidthWeights: loanAdvanceEnabled
                ? [8, 14, 8, 8, 8, 8, 8, 8, 8, 8]
                : [10, 17, 10, 10, 10, 10, 10, 10],
            totalsRow,
        },
    };
};
