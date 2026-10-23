// Mirrors components/reports/AttendanceSummaryClient.tsx's buildAttendanceSummaryWordOptions().
// Flat report, no grouping. totalsRow is reconstructed by summing the Present/Absent/Half
// Day/Full Day columns across the fetched rows (fetchAttendanceSummary already returns the
// same 6 columns in the same order as the client's own export builder).
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildAttendanceSummaryWordExport: WordOptionsBuilder = (headers, rows) => {
    const sum = (colIndex: number) => rows.reduce((s, r) => s + Number(r[colIndex] ?? 0), 0);
    const totalsRow = ['', 'Grand Total', sum(2), sum(3), sum(4), sum(5)];

    return {
        bodyRows: rows,
        options: {
            columnAlignments: ['left', 'left', 'right', 'right', 'right', 'right'],
            columnWidthWeights: [14, 16, 8, 8, 8, 8],
            totalsRow,
        },
    };
};
