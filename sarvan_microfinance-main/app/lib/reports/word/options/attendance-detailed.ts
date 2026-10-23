// Mirrors components/reports/AttendanceDetailedClient.tsx's buildAttendanceDetailedWordOptions().
// Flat report, no grouping. The client's trailing "Grand Total:" row is a status-count summary
// (not a numeric sum) — reconstructed here by counting the Status column (index 3) across the
// fetched rows, matching fetchAttendanceDetailed's raw enum values (PRESENT/ABSENT/FULL_DAY/HALF_DAY).
import type { WordOptionsBuilder } from '@/app/lib/reports/word/options-registry';

export const buildAttendanceDetailedWordExport: WordOptionsBuilder = (headers, rows) => {
    if (rows.length === 0) {
        return { bodyRows: rows, options: { columnAlignments: ['center', 'left', 'left', 'center', 'center', 'center'], columnWidthWeights: [9, 14, 14, 9, 9, 9] } };
    }
    const count = (status: string) => rows.filter((r) => r[3] === status).length;
    const present = count('PRESENT');
    const absent = count('ABSENT');
    const halfDay = count('HALF_DAY');
    const totalsRow = ['Grand Total:', `${rows.length} Records`, `Present: ${present}, Absent: ${absent}, Half Day: ${halfDay}`, '', '', ''];

    return {
        bodyRows: rows,
        options: {
            columnAlignments: ['center', 'left', 'left', 'center', 'center', 'center'],
            columnWidthWeights: [9, 14, 14, 9, 9, 9],
            totalsRow,
        },
    };
};
