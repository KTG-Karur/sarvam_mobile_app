import { describe, it, expect } from 'vitest';
import { computeUnpaidDays, describeUnpaidDays, type PayrollAttendanceRow, type WeeklySchedule } from './attendance-days';

const schedule: WeeklySchedule = { sunday: false, monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: true };

// September 2026 — Sundays are the 6th, 13th, 20th, 27th.
const ymd = (d: number) => `2026-09-${String(d).padStart(2, '0')}`;
const present = (d: number): PayrollAttendanceRow => ({
    dateYmd: ymd(d), status: 'PRESENT', isHoliday: false, isHalfDayLeave: false, lopLocked: false, leaveTypeId: null, leaveIsLop: false,
});
const allPresent = () => Array.from({ length: 30 }, (_, i) => present(i + 1));

const base = {
    month: 9, year: 2026, todayYmd: '2026-10-05', schedule, dateOverrides: [] as { date: string; isWorkingDay: boolean }[], leaves: [],
};

describe('computeUnpaidDays', () => {
    it('no unpaid days when every day has a paid record', () => {
        expect(computeUnpaidDays({ ...base, rows: allPresent() }).lopDays).toBe(0);
    });

    it('a permission-quota LOP row (lopLocked) is unpaid even without the isLop flag', () => {
        const rows = allPresent();
        rows[1] = { ...present(2), status: 'ABSENT', lopLocked: true, leaveTypeId: 'lop' };
        const r = computeUnpaidDays({ ...base, rows });
        expect(r.lopDays).toBe(1);
        expect(r.breakdown.lopLeaveDays).toBe(1);
    });

    it('a half-day LEAVE is paid (worked half + leave half) unless the leave type is Loss of Pay', () => {
        const paid = allPresent();
        paid[8] = { ...present(9), status: 'HALF_DAY', isHalfDayLeave: true, leaveTypeId: 'cl' };
        expect(computeUnpaidDays({ ...base, rows: paid }).lopDays).toBe(0);

        const lop = allPresent();
        lop[8] = { ...present(9), status: 'HALF_DAY', isHalfDayLeave: true, leaveTypeId: 'lop', leaveIsLop: true };
        expect(computeUnpaidDays({ ...base, rows: lop }).lopDays).toBe(0.5);
    });

    it('an approved paid leave with no punch record is paid; approved LOP leave is unpaid', () => {
        const rows = allPresent().filter((r) => r.dateYmd !== ymd(10) && r.dateYmd !== ymd(11));
        const paid = computeUnpaidDays({ ...base, rows, leaves: [{ fromYmd: ymd(10), toYmd: ymd(11), isHalfDay: false, isLop: false }] });
        expect(paid.lopDays).toBe(0);
        const lop = computeUnpaidDays({ ...base, rows, leaves: [{ fromYmd: ymd(10), toYmd: ymd(11), isHalfDay: false, isLop: true }] });
        expect(lop.lopDays).toBe(2);
    });

    it('an approved half-day leave with no record: the leave half is paid, the other half is unpaid', () => {
        const rows = allPresent().filter((r) => r.dateYmd !== ymd(10));
        const r = computeUnpaidDays({ ...base, rows, leaves: [{ fromYmd: ymd(10), toYmd: ymd(10), isHalfDay: true, isLop: false }] });
        expect(r.lopDays).toBe(0.5);
    });

    it('days after today are still upcoming, not absent', () => {
        const r = computeUnpaidDays({ ...base, todayYmd: ymd(15), rows: [] });
        // Sep 1-15 working days without a record = 15 days minus Sundays (6, 13) = 13
        expect(r.breakdown.absentDays).toBe(13);
    });

    it('a date-override holiday on a working day is paid; a working-day override on a Sunday is absent when unmarked', () => {
        const rows = allPresent().filter((r) => r.dateYmd !== ymd(8) && r.dateYmd !== ymd(6));
        const r = computeUnpaidDays({
            ...base, rows,
            dateOverrides: [{ date: ymd(8), isWorkingDay: false }, { date: ymd(6), isWorkingDay: true }],
        });
        expect(r.lopDays).toBe(1); // only Sunday the 6th, declared a working day
    });

    it('unpaid for days before joining and after the exit date, including weekly offs', () => {
        const r = computeUnpaidDays({ ...base, rows: allPresent(), joinYmd: ymd(5), exitYmd: ymd(25) });
        expect(r.breakdown.notEmployedDays).toBe(4 + 5); // 1-4 and 26-30
        expect(r.lopDays).toBe(9);
    });

    it('describeUnpaidDays gives a readable note', () => {
        expect(describeUnpaidDays({ absentDays: 2, halfDayShortfall: 0.5, lopLeaveDays: 0, notEmployedDays: 0 }))
            .toBe('From attendance: 2 absent · 0.5 half-day short');
        expect(describeUnpaidDays({ absentDays: 0, halfDayShortfall: 0, lopLeaveDays: 0, notEmployedDays: 0 }))
            .toBe('From attendance: no unpaid days');
    });
});
