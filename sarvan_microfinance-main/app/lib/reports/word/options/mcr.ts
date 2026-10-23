// Mirrors components/reports/MCRClient.tsx's static `wordOptions` literal. Grouped
// (Opening Arrear / Current Demand / Total Demand / Total Collected Principal-Interest
// pairs), no totals row (none exists in the direct export either). fetchMcr (report-registry.ts)
// reuses the shared buildCcrExportRows() helper, which returns the exact same 19 columns in
// the exact same order as the client's own buildMCRExportRows().
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildMcrWordExport: WordOptionsBuilder = (headers, rows) => {
    // buildCcrExportRows (report-registry.ts, shared with CCR) drops "Loan
    // Advance" entirely when the feature is disabled.
    const loanAdvanceEnabled = headers.includes('Loan Advance');
    return {
        bodyRows: rows,
        options: {
            groupHeaders: [
                { label: 'Trans Date', span: 1 }, { label: 'Center Name', span: 1 }, { label: 'Client Name', span: 1 },
                { label: 'Loan Amt', span: 1 }, { label: 'Loan A/c', span: 1 }, { label: 'OPENING ARREAR', span: 2 },
                { label: 'CURRENT DEMAND', span: 2 }, { label: 'TOTAL DEMAND', span: 2 }, { label: 'TOTAL COLLECTED', span: 2 },
                ...(loanAdvanceEnabled ? [{ label: 'Loan Advance', span: 1 }] : []), { label: 'Done At', span: 1 }, { label: 'Coll Type', span: 1 },
                { label: 'Trans Type', span: 1 }, { label: 'Reference No', span: 1 }, { label: 'Emp Name', span: 1 },
            ],
            subHeaders: ['Principal', 'Interest', 'Principal', 'Interest', 'Principal', 'Interest', 'Principal', 'Interest'],
            columnAlignments: [
                'center', 'left', 'left', 'right', 'center', 'right', 'right', 'right', 'right', 'right', 'right', 'right', 'right',
                ...(loanAdvanceEnabled ? (['right'] as const) : []), 'center', 'center', 'center', 'center', 'left',
            ],
            columnWidthWeights: [7, 10, 12, 7, 8, 6, 6, 6, 6, 6, 6, 6, 6, ...(loanAdvanceEnabled ? [7] : []), 7, 7, 7, 8, 9],
        },
    };
};
