// Mirrors components/reports/MeetingCheckClient.tsx's static `wordOptions` literal. Grouped
// (Expected/Actual/Variance collection cluster), no totals row (none exists in the direct
// export either). fetchMeetingCheck (report-registry.ts) returns the exact same 9 columns in
// the exact same order as the client's own buildMeetingCheckExportRows().
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildMeetingCheckWordExport: WordOptionsBuilder = (headers, rows) => ({
    bodyRows: rows,
    options: {
        groupHeaders: [
            { label: 'Center Code', span: 1 }, { label: 'Center Name', span: 1 }, { label: 'FDO Name', span: 1 },
            { label: 'Meeting Time', span: 1 }, { label: 'Clients', span: 1 }, { label: 'Status', span: 1 },
            { label: 'COLLECTION', span: 3 },
        ],
        subHeaders: ['Expected', 'Actual', 'Variance'],
        columnAlignments: ['center', 'left', 'left', 'center', 'right', 'center', 'right', 'right', 'right'],
        columnWidthWeights: [8, 12, 12, 8, 7, 9, 9, 9, 9],
    },
});
