import { describe, expect, it } from 'vitest';
import {
    buildSalaryDueDates, defaultFirstDueMonth, firstSalaryDueDate, isValidSalaryDay, salaryDueDate,
} from './salary-schedule';

// Reference calendar: 2026-10-04 is a Sunday (2026-09-27, 2026-10-11 and 2026-11-01 are Sundays too).
const dayOfWeek = (ymd: string) => new Date(`${ymd}T00:00:00Z`).getUTCDay();

describe('salaryDueDate', () => {
    it('uses the salary day as-is when it is not a Sunday', () => {
        expect(salaryDueDate(2026, 10, 5)).toBe('2026-10-05'); // Monday
        expect(salaryDueDate(2026, 10, 3)).toBe('2026-10-03'); // Saturday stays
    });

    it('moves a Sunday salary day back one day to the Saturday', () => {
        expect(dayOfWeek('2026-10-04')).toBe(0);
        expect(salaryDueDate(2026, 10, 4)).toBe('2026-10-03');
        expect(salaryDueDate(2026, 10, 11)).toBe('2026-10-10');
    });

    it('moves back into the previous month when the 1st is a Sunday', () => {
        expect(dayOfWeek('2026-11-01')).toBe(0);
        expect(salaryDueDate(2026, 11, 1)).toBe('2026-10-31');
        expect(salaryDueDate(2026, 3, 1)).toBe('2026-02-28'); // Sun 1 Mar 2026 -> Sat 28 Feb
    });

    it('clamps a salary day past the end of a short month, then applies the Sunday rule', () => {
        expect(salaryDueDate(2026, 2, 31)).toBe('2026-02-28'); // Saturday
        expect(salaryDueDate(2028, 2, 30)).toBe('2028-02-29'); // leap year, Tuesday
        expect(salaryDueDate(2026, 11, 30)).toBe('2026-11-30'); // Monday
        expect(dayOfWeek('2026-05-31')).toBe(0);
        expect(salaryDueDate(2026, 5, 31)).toBe('2026-05-30'); // Sunday -> Saturday
        expect(dayOfWeek('2027-02-28')).toBe(0);
        expect(salaryDueDate(2027, 2, 31)).toBe('2027-02-27'); // clamped to a Sunday, then back a day
    });
});

describe('first due date month option', () => {
    it('THIS_MONTH uses the disbursement month, NEXT_MONTH the following one', () => {
        expect(dayOfWeek('2026-09-25')).toBe(5); // Friday
        expect(firstSalaryDueDate('2026-09-20', 'THIS_MONTH', 25)).toBe('2026-09-25');
        expect(firstSalaryDueDate('2026-09-20', 'NEXT_MONTH', 26)).toBe('2026-10-26'); // Monday
        expect(dayOfWeek('2026-10-25')).toBe(0); // 25 Oct is a Sunday, so a salary day of 25 falls on Saturday 24 Oct
        expect(firstSalaryDueDate('2026-09-20', 'NEXT_MONTH', 25)).toBe('2026-10-24');
    });

    it('rolls over the year for NEXT_MONTH in December', () => {
        expect(firstSalaryDueDate('2026-12-10', 'NEXT_MONTH', 5)).toBe('2027-01-05');
    });

    it('applies the Sunday rule to the first due date', () => {
        expect(firstSalaryDueDate('2026-09-20', 'NEXT_MONTH', 4)).toBe('2026-10-03');
    });

    it('preselects this month only while its salary date is still ahead', () => {
        expect(defaultFirstDueMonth('2026-09-20', 25)).toBe('THIS_MONTH');
        expect(defaultFirstDueMonth('2026-09-25', 25)).toBe('THIS_MONTH'); // same day still counts
        expect(defaultFirstDueMonth('2026-09-26', 25)).toBe('NEXT_MONTH');
        expect(defaultFirstDueMonth('2026-10-03', 4)).toBe('THIS_MONTH'); // 4 Oct is a Sunday -> due Sat 3 Oct, not passed
        expect(defaultFirstDueMonth('2026-10-04', 4)).toBe('NEXT_MONTH'); // due Sat 3 Oct already passed
    });
});

describe('buildSalaryDueDates (the loan schedule)', () => {
    it('creates one due date per installment on consecutive months', () => {
        expect(buildSalaryDueDates('2026-09-20', 'NEXT_MONTH', 5, 4)).toEqual(['2026-10-05', '2026-11-05', '2026-12-05', '2027-01-05']);
    });

    it('applies the Sunday rule to every installment, not only the first', () => {
        // salary day 4: Oct 4 2026 = Sun, Nov 4 = Wed, Dec 4 = Fri, Jan 4 2027 = Mon, Feb 4 = Thu, Mar 4 = Thu
        expect(buildSalaryDueDates('2026-09-20', 'NEXT_MONTH', 4, 3)).toEqual(['2026-10-03', '2026-11-04', '2026-12-04']);
        // salary day 7: Feb 7 2027 = Sun -> Sat Feb 6; Mar 7 2027 = Sun -> Sat Mar 6
        expect(buildSalaryDueDates('2027-01-01', 'THIS_MONTH', 7, 3)).toEqual(['2027-01-07', '2027-02-06', '2027-03-06']);
        for (const due of buildSalaryDueDates('2026-01-01', 'THIS_MONTH', 4, 24)) expect(dayOfWeek(due)).not.toBe(0);
    });

    it('does not drift on day 31: every month uses its own last day instead of overflowing', () => {
        // Sat 31 Jan, Sat 28 Feb (clamped), Tue 31 Mar, Thu 30 Apr (clamped) - none is a Sunday
        expect(buildSalaryDueDates('2026-01-10', 'THIS_MONTH', 31, 4)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    });

    it('spans year ends and long tenures', () => {
        const dates = buildSalaryDueDates('2026-11-15', 'NEXT_MONTH', 10, 14);
        expect(dates).toHaveLength(14);
        expect(dates[0]).toBe('2026-12-10');
        expect(dates[1]).toBe('2027-01-09'); // 10 Jan 2027 is a Sunday
        expect(dates[13]).toBe(salaryDueDate(2028, 1, 10));
        expect(new Set(dates).size).toBe(14);
    });
});

describe('isValidSalaryDay', () => {
    it('accepts whole days 1-31 only', () => {
        expect(isValidSalaryDay(1)).toBe(true);
        expect(isValidSalaryDay(31)).toBe(true);
        for (const bad of [0, 32, -1, 5.5, NaN, '5', null, undefined]) expect(isValidSalaryDay(bad)).toBe(false);
    });
});
