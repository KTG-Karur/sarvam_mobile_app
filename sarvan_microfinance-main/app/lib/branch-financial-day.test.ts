import { describe, expect, it } from 'vitest';
import {
    getBranchCalendarDayHalfOpenUtc,
    getCalendarYmdInTimeZone,
    getWeekdayNameInTimeZone,
    isWorkingDateAheadOfBranchCalendarToday,
    parseDenominationEntryDateUtc,
} from '@/app/lib/branch-financial-day';

describe('parseDenominationEntryDateUtc', () => {
    it('parses YYYY-MM-DD to UTC midnight anchor', () => {
        const d = parseDenominationEntryDateUtc('2026-03-28');
        expect(d.toISOString()).toBe('2026-03-28T00:00:00.000Z');
    });

    it('rejects invalid strings', () => {
        expect(() => parseDenominationEntryDateUtc('28-03-2026')).toThrow();
    });
});

describe('getBranchCalendarDayHalfOpenUtc', () => {
    it('returns 24h half-open window for Asia/Kolkata', () => {
        const ref = new Date('2026-03-28T12:00:00.000Z');
        const { dayStartUtc, dayEndExclusiveUtc, workingDateYmd } = getBranchCalendarDayHalfOpenUtc(
            ref,
            'Asia/Kolkata'
        );
        expect(workingDateYmd).toBe('2026-03-28');
        const spanMs = dayEndExclusiveUtc.getTime() - dayStartUtc.getTime();
        expect(spanMs).toBe(24 * 60 * 60 * 1000);
        expect(dayStartUtc.toISOString()).toBe('2026-03-27T18:30:00.000Z');
    });
});

describe('getCalendarYmdInTimeZone', () => {
    it('formats instant in target timezone', () => {
        const instant = new Date('2026-03-27T20:00:00.000Z');
        expect(getCalendarYmdInTimeZone(instant, 'Asia/Kolkata')).toBe('2026-03-28');
    });
});

describe('getWeekdayNameInTimeZone', () => {
    it('returns English long weekday in timezone', () => {
        const saturdayIst = new Date('2026-03-28T12:00:00.000Z');
        expect(getWeekdayNameInTimeZone(saturdayIst, 'Asia/Kolkata')).toBe('Saturday');
    });
});

describe('isWorkingDateAheadOfBranchCalendarToday', () => {
    it('is true when working calendar date is after today in branch TZ', () => {
        const now = new Date('2026-03-28T12:00:00.000Z');
        const working = new Date('2026-03-29T00:00:00.000Z');
        expect(isWorkingDateAheadOfBranchCalendarToday(working, now, 'Asia/Kolkata')).toBe(true);
    });

    it('is false when working date equals calendar today', () => {
        const now = new Date('2026-03-28T12:00:00.000Z');
        const working = new Date('2026-03-28T06:30:00.000Z');
        expect(isWorkingDateAheadOfBranchCalendarToday(working, now, 'Asia/Kolkata')).toBe(false);
    });
});
