import { describe, expect, it } from 'vitest';
import {
    computeNextMeetingDateYmd,
    formatYmdToDmy,
    normalizeMeetingDayName,
    toIstWeekdayName,
} from '@/app/lib/collections/next-meeting-date';

describe('normalizeMeetingDayName', () => {
    it('normalizes variants and abbreviations', () => {
        expect(normalizeMeetingDayName('Monday')).toBe('Monday');
        expect(normalizeMeetingDayName('monday')).toBe('Monday');
        expect(normalizeMeetingDayName('MONDAY')).toBe('Monday');
        expect(normalizeMeetingDayName('Mon')).toBe('Monday');
        expect(normalizeMeetingDayName(' mon ')).toBe('Monday');
    });

    it('returns null for unrecognized/empty input', () => {
        expect(normalizeMeetingDayName(null)).toBeNull();
        expect(normalizeMeetingDayName(undefined)).toBeNull();
        expect(normalizeMeetingDayName('')).toBeNull();
        expect(normalizeMeetingDayName('Someday')).toBeNull();
    });
});

describe('computeNextMeetingDateYmd', () => {
    it('returns today when today matches meetingDay (ticket example: today Monday, meeting Monday)', () => {
        // 2026-07-06 is a Monday (IST)
        const today = new Date('2026-07-06T10:00:00+05:30');
        expect(toIstWeekdayName(today)).toBe('Monday');
        expect(computeNextMeetingDateYmd('Monday', today)).toBe('2026-07-06');
    });

    it('returns upcoming date when meetingDay differs (ticket example: today Friday, meeting Monday)', () => {
        // 2026-07-10 is a Friday (IST)
        const friday = new Date('2026-07-10T10:00:00+05:30');
        expect(toIstWeekdayName(friday)).toBe('Friday');
        expect(computeNextMeetingDateYmd('Monday', friday)).toBe('2026-07-13');
    });

    it('wraps across the week boundary (Saturday -> next Monday)', () => {
        // 2026-07-11 is a Saturday (IST)
        const saturday = new Date('2026-07-11T10:00:00+05:30');
        expect(toIstWeekdayName(saturday)).toBe('Saturday');
        expect(computeNextMeetingDateYmd('Monday', saturday)).toBe('2026-07-13');
    });

    it('handles day-name variants stored in DB', () => {
        const today = new Date('2026-07-06T10:00:00+05:30');
        expect(computeNextMeetingDateYmd('mon', today)).toBe('2026-07-06');
        expect(computeNextMeetingDateYmd('MON', today)).toBe('2026-07-06');
    });

    it('returns null for unrecognized/empty meetingDay', () => {
        const today = new Date('2026-07-06T10:00:00+05:30');
        expect(computeNextMeetingDateYmd(null, today)).toBeNull();
        expect(computeNextMeetingDateYmd('', today)).toBeNull();
        expect(computeNextMeetingDateYmd('Someday', today)).toBeNull();
    });
});

describe('formatYmdToDmy', () => {
    it('converts YYYY-MM-DD to DD/MM/YYYY', () => {
        expect(formatYmdToDmy('2026-07-06')).toBe('06/07/2026');
    });
});
