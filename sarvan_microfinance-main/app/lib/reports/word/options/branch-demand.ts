// Mirrors components/reports/BranchDemandClient.tsx's buildBranchDemandWordOptions().
// 15 columns, grouped (OS/Arrear/Demand Principal-Interest(-Savings) triples). totalsRow is
// reconstructed by summing columns 4-14 across the fetched rows — fetchBranchDemandField
// returns the exact same 15 columns in the exact same order as the client's own builder.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildBranchDemandWordExport: WordOptionsBuilder = (headers, rows) => {
    // fetchBranchDemandField (report-registry.ts) drops the two "Arrear Sav"/"Demand
    // Sav" columns entirely when the feature is disabled — detect that from the header
    // count (15 with, 13 without) rather than hardcoding, so this stays in sync.
    const loanAdvanceEnabled = headers.length === 15;
    const sum = (colIndex: number) => rows.reduce((s, r) => s + Number(r[colIndex] ?? 0), 0);
    const totalsRow = loanAdvanceEnabled
        ? ['', 'GRAND TOTAL', '', '', sum(4), sum(5), sum(6), sum(7), sum(8), sum(9), sum(10), sum(11), sum(12), sum(13), sum(14)]
        : ['', 'GRAND TOTAL', '', '', sum(4), sum(5), sum(6), sum(7), sum(8), sum(9), sum(10), sum(11), sum(12)];

    return {
        bodyRows: rows,
        options: {
            groupHeaders: [
                { label: 'Sl No', span: 1 },
                { label: 'FDO', span: 1 },
                { label: 'Center', span: 1 },
                { label: 'Meeting Time', span: 1 },
                { label: '# Clients', span: 1 },
                { label: 'WB', span: 1 },
                { label: 'OS', span: 2 },
                { label: 'ARREAR', span: loanAdvanceEnabled ? 3 : 2 },
                { label: 'DEMAND', span: loanAdvanceEnabled ? 3 : 2 },
                { label: 'Total Demand', span: 1 },
            ],
            subHeaders: loanAdvanceEnabled
                ? ['Principal', 'Interest', 'Principal', 'Interest', 'Savings', 'Principal', 'Interest', 'Savings']
                : ['Principal', 'Interest', 'Principal', 'Interest', 'Principal', 'Interest'],
            columnAlignments: loanAdvanceEnabled
                ? ['center', 'left', 'left', 'center', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right']
                : ['center', 'left', 'left', 'center', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right'],
            columnWidthWeights: loanAdvanceEnabled
                ? [4, 10, 12, 8, 6, 6, 8, 8, 8, 8, 8, 8, 8, 8, 9]
                : [4, 11, 13, 9, 7, 7, 9, 9, 9, 9, 9, 9, 10],
            totalsRow,
        },
    };
};
