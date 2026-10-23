import { describe, expect, it } from 'vitest';
import {
    computeFirstRepaymentDate,
    generateDailyRepaymentDates,
    toLocalISODate,
    type DailyScheduleConfig,
} from '@/app/lib/schedule/daily-schedule';

function date(iso: string): Date {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function dayName(d: Date): string {
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
}

// ─── toLocalISODate ─────────────────────────────────────────────────────────

describe('toLocalISODate', () => {
    it('formats date as YYYY-MM-DD using local calendar', () => {
        expect(toLocalISODate(date('2026-04-01'))).toBe('2026-04-01');
    });

    it('pads single-digit months and days', () => {
        expect(toLocalISODate(date('2026-01-05'))).toBe('2026-01-05');
    });

    it('handles Dec 31 / Jan 1 transitions', () => {
        expect(toLocalISODate(date('2025-12-31'))).toBe('2025-12-31');
        expect(toLocalISODate(date('2026-01-01'))).toBe('2026-01-01');
    });

    it('handles leap year Feb 29', () => {
        expect(toLocalISODate(date('2028-02-29'))).toBe('2028-02-29');
    });
});

// ─── computeFirstRepaymentDate ──────────────────────────────────────────────

describe('computeFirstRepaymentDate', () => {
    it('returns disbursement + 2 days on a normal weekday', () => {
        const disbursement = date('2026-04-01'); // Wednesday
        const first = computeFirstRepaymentDate(disbursement);
        expect(toLocalISODate(first)).toBe('2026-04-03'); // Friday
    });

    it('skips Sunday when offset lands on it', () => {
        const disbursement = date('2026-04-03'); // Friday → +2 = Sunday
        const first = computeFirstRepaymentDate(disbursement);
        expect(toLocalISODate(first)).toBe('2026-04-06'); // Monday
        expect(first.getDay()).not.toBe(0);
    });

    it('disbursement on Friday → first repayment Monday (skip Sunday)', () => {
        const disbursement = date('2026-04-03'); // Friday
        const first = computeFirstRepaymentDate(disbursement);
        expect(dayName(first)).toBe('Mon');
    });

    it('disbursement on Saturday → first repayment Monday', () => {
        const disbursement = date('2026-04-04'); // Saturday → +2 = Monday
        const first = computeFirstRepaymentDate(disbursement);
        expect(toLocalISODate(first)).toBe('2026-04-06'); // Monday
    });

    it('skips holiday when offset lands on it', () => {
        const disbursement = date('2026-04-01'); // Wed → +2 = Fri
        const config: DailyScheduleConfig = { holidays: ['2026-04-03'] };
        const first = computeFirstRepaymentDate(disbursement, config);
        expect(toLocalISODate(first)).toBe('2026-04-04'); // Saturday
    });

    it('skips consecutive Sunday + holiday', () => {
        const disbursement = date('2026-04-03'); // Fri → +2 = Sun(skip) → Mon is holiday
        const config: DailyScheduleConfig = { holidays: ['2026-04-06'] };
        const first = computeFirstRepaymentDate(disbursement, config);
        expect(toLocalISODate(first)).toBe('2026-04-07'); // Tuesday
    });

    it('respects custom offset days', () => {
        const disbursement = date('2026-04-01'); // Wednesday
        const config: DailyScheduleConfig = { offsetDays: 3 };
        const first = computeFirstRepaymentDate(disbursement, config);
        expect(toLocalISODate(first)).toBe('2026-04-04'); // Saturday
    });

    it('respects custom non-working days (Saturday + Sunday)', () => {
        const disbursement = date('2026-04-01'); // Wed → +2 = Fri
        const config: DailyScheduleConfig = { nonWorkingDays: [0, 6] };
        const first = computeFirstRepaymentDate(disbursement, config);
        expect(toLocalISODate(first)).toBe('2026-04-03'); // Friday (valid)
    });
});

// ─── generateDailyRepaymentDates ────────────────────────────────────────────

describe('generateDailyRepaymentDates', () => {
    it('matches the QA example: disbursement 2026-04-01, tenure 5 days', () => {
        const disbursement = date('2026-04-01'); // Wednesday
        const result = generateDailyRepaymentDates(disbursement, 5);

        expect(result.dates).toHaveLength(5);

        const isos = result.dates.map(d => d.isoDate);
        expect(isos).toEqual([
            '2026-04-03', // Fri
            '2026-04-04', // Sat
            '2026-04-06', // Mon (Sunday skipped)
            '2026-04-07', // Tue
            '2026-04-08', // Wed
        ]);
    });

    it('never includes a Sunday', () => {
        const disbursement = date('2026-04-01');
        const result = generateDailyRepaymentDates(disbursement, 60);

        for (const entry of result.dates) {
            expect(entry.date.getDay()).not.toBe(0);
        }
    });

    it('produces exactly numberOfDues entries', () => {
        const disbursement = date('2026-04-01');
        const result = generateDailyRepaymentDates(disbursement, 100);
        expect(result.dates).toHaveLength(100);
    });

    it('all installmentNo values are sequential 1..n', () => {
        const result = generateDailyRepaymentDates(date('2026-04-01'), 30);
        const nums = result.dates.map(d => d.installmentNo);
        expect(nums).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    });

    it('dates are strictly ascending', () => {
        const result = generateDailyRepaymentDates(date('2026-04-01'), 50);
        for (let i = 1; i < result.dates.length; i++) {
            expect(result.dates[i].date.getTime()).toBeGreaterThan(
                result.dates[i - 1].date.getTime()
            );
        }
    });

    it('is deterministic — same input always produces same output', () => {
        const d = date('2026-06-15');
        const r1 = generateDailyRepaymentDates(d, 20);
        const r2 = generateDailyRepaymentDates(d, 20);
        expect(r1.dates.map(x => x.isoDate)).toEqual(r2.dates.map(x => x.isoDate));
    });

    it('skips holidays correctly', () => {
        const disbursement = date('2026-04-01'); // Wed
        const holidays = ['2026-04-04']; // Saturday = holiday too
        const result = generateDailyRepaymentDates(disbursement, 5, { holidays });

        const isos = result.dates.map(d => d.isoDate);
        expect(isos).toEqual([
            '2026-04-03', // Fri
            // Sat is holiday, Sun is non-working → both skipped
            '2026-04-06', // Mon
            '2026-04-07', // Tue
            '2026-04-08', // Wed
            '2026-04-09', // Thu
        ]);
    });

    it('handles consecutive holidays + Sunday block', () => {
        const disbursement = date('2026-04-01');
        const holidays = ['2026-04-04', '2026-04-06']; // Sat + Mon holiday
        const result = generateDailyRepaymentDates(disbursement, 5, { holidays });

        const isos = result.dates.map(d => d.isoDate);
        expect(isos).toEqual([
            '2026-04-03', // Fri
            // Sat=holiday, Sun=non-working, Mon=holiday → all skipped
            '2026-04-07', // Tue
            '2026-04-08', // Wed
            '2026-04-09', // Thu
            '2026-04-10', // Fri
        ]);
    });

    it('handles month-end transitions', () => {
        const disbursement = date('2026-04-28'); // Tue → +2 = Thu Apr 30
        const result = generateDailyRepaymentDates(disbursement, 5);
        const isos = result.dates.map(d => d.isoDate);

        expect(isos[0]).toBe('2026-04-30'); // Thu
        expect(isos[1]).toBe('2026-05-01'); // Fri
        expect(isos[2]).toBe('2026-05-02'); // Sat
        // Sun May 3 skipped
        expect(isos[3]).toBe('2026-05-04'); // Mon
        expect(isos[4]).toBe('2026-05-05'); // Tue
    });

    it('handles leap year February', () => {
        const disbursement = date('2028-02-27'); // Sun → +2 = Tue Feb 29
        const result = generateDailyRepaymentDates(disbursement, 3);

        expect(result.dates[0].isoDate).toBe('2028-02-29'); // Tue
        expect(result.dates[1].isoDate).toBe('2028-03-01'); // Wed
        expect(result.dates[2].isoDate).toBe('2028-03-02'); // Thu
    });

    it('tracks skipped days with correct reasons', () => {
        const disbursement = date('2026-04-03'); // Fri → +2 = Sun
        const result = generateDailyRepaymentDates(disbursement, 3, {
            holidays: ['2026-04-06'],
        });

        const sundaySkip = result.skippedDays.find(s => s.date === '2026-04-05');
        const holidaySkip = result.skippedDays.find(s => s.date === '2026-04-06');

        expect(sundaySkip).toBeDefined();
        expect(sundaySkip?.reason).toBe('non_working_day');
        expect(holidaySkip).toBeDefined();
        expect(holidaySkip?.reason).toBe('holiday');
    });

    it('returns correct config metadata', () => {
        const result = generateDailyRepaymentDates(
            date('2026-04-01'),
            5,
            { offsetDays: 3, nonWorkingDays: [0, 6], holidays: ['2026-04-05'] },
        );
        expect(result.config.offsetDays).toBe(3);
        expect(result.config.nonWorkingDays).toEqual([0, 6]);
        expect(result.config.holidayCount).toBe(1);
    });

    it('handles disbursement on Saturday with Sunday excluded', () => {
        const disbursement = date('2026-04-04'); // Sat → +2 = Mon
        const result = generateDailyRepaymentDates(disbursement, 3);
        expect(result.dates[0].isoDate).toBe('2026-04-06'); // Monday
    });

    it('works with zero holidays (default)', () => {
        const result = generateDailyRepaymentDates(date('2026-04-01'), 3);
        expect(result.config.holidayCount).toBe(0);
        expect(result.dates).toHaveLength(3);
    });

    it('handles large tenure (180 days ~ 6 months daily)', () => {
        const result = generateDailyRepaymentDates(date('2026-01-01'), 180);
        expect(result.dates).toHaveLength(180);

        for (const entry of result.dates) {
            expect(entry.date.getDay()).not.toBe(0);
        }
    });

    it('skips only configured non-working days, not others', () => {
        const result = generateDailyRepaymentDates(
            date('2026-04-01'),
            7,
            { nonWorkingDays: [6] }, // Skip Saturday only, not Sunday
        );

        const days = result.dates.map(d => d.date.getDay());
        expect(days).not.toContain(6); // No Saturday
        // Sunday IS allowed
    });
});
