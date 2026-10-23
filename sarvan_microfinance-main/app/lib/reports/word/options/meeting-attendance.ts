// Mirrors components/reports/MeetingAttendanceClient.tsx's inline wordOptions in
// handleExportWord(). Flat, 8 columns — fetchMeetingAttendance (report-registry.ts) returns
// the exact same column order as the client's buildMeetingAttendanceExportRows(). The registry
// fetch never appends a 'Grand Total:' row (attendance status isn't summable), so the same
// hasTotals check naturally evaluates false here too, matching the client's own behavior.
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildMeetingAttendanceWordExport: WordOptionsBuilder = (headers, rows) => {
    const hasTotals = rows.length > 0 && rows[rows.length - 1][0] === 'Grand Total:';
    return {
        bodyRows: hasTotals ? rows.slice(0, -1) : rows,
        options: {
            columnAlignments: ['center', 'left', 'left', 'center', 'center', 'center', 'center', 'left'],
            columnWidthWeights: [8, 14, 12, 8, 9, 9, 8, 10],
            totalsRow: hasTotals ? (rows[rows.length - 1] as (string | number)[]) : undefined,
        },
    };
};
