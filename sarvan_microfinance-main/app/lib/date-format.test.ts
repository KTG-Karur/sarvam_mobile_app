import { describe, expect, it } from 'vitest';
import { parseDisplayDate, toDisplayDate, toDisplayDateTime } from './date-format';

describe('toDisplayDate — DD/MM/YYYY in India time', () => {
    it('formats Date objects, ISO strings and timestamps', () => {
        expect(toDisplayDate(new Date('2026-10-01T06:30:00Z'))).toBe('01/10/2026');
        expect(toDisplayDate('2026-10-01T06:30:00.000Z')).toBe('01/10/2026');
        expect(toDisplayDate(Date.UTC(2026, 9, 1, 6, 30))).toBe('01/10/2026');
    });

    it('uses IST, not the server time zone, near midnight', () => {
        // 20:00 UTC on 30 Sep = 01:30 IST on 1 Oct
        expect(toDisplayDate(new Date('2026-09-30T20:00:00Z'))).toBe('01/10/2026');
    });

    it('keeps a bare calendar date as-is (no time-zone shift)', () => {
        expect(toDisplayDate('2026-10-01')).toBe('01/10/2026');
        expect(toDisplayDate('2026-01-31')).toBe('31/01/2026');
    });

    it('returns the fallback for empty or invalid values', () => {
        expect(toDisplayDate(null)).toBe('');
        expect(toDisplayDate(undefined, '—')).toBe('—');
        expect(toDisplayDate('', '-')).toBe('-');
        expect(toDisplayDate('not a date', 'N/A')).toBe('N/A');
    });
});

describe('toDisplayDateTime — DD/MM/YYYY hh:mm AM/PM in India time', () => {
    it('formats afternoon, morning, noon and midnight', () => {
        expect(toDisplayDateTime(new Date('2026-10-01T09:00:00Z'))).toBe('01/10/2026 02:30 PM');
        expect(toDisplayDateTime(new Date('2026-10-01T03:00:00Z'))).toBe('01/10/2026 08:30 AM');
        expect(toDisplayDateTime(new Date('2026-10-01T06:30:00Z'))).toBe('01/10/2026 12:00 PM');
        expect(toDisplayDateTime(new Date('2026-09-30T18:30:00Z'))).toBe('01/10/2026 12:00 AM');
    });

    it('returns the fallback for empty values', () => {
        expect(toDisplayDateTime(null, '—')).toBe('—');
    });
});

describe('parseDisplayDate — typed DD/MM/YYYY → yyyy-MM-dd', () => {
    it('parses valid dates (with or without leading zeros)', () => {
        expect(parseDisplayDate('01/10/2026')).toBe('2026-10-01');
        expect(parseDisplayDate('1/2/2026')).toBe('2026-02-01');
        expect(parseDisplayDate('29/02/2028')).toBe('2028-02-29');
    });

    it('rejects impossible or incomplete dates', () => {
        expect(parseDisplayDate('31/02/2026')).toBeNull();
        expect(parseDisplayDate('29/02/2026')).toBeNull();
        expect(parseDisplayDate('13/13/2026')).toBeNull();
        expect(parseDisplayDate('01/10/26')).toBeNull();
        expect(parseDisplayDate('')).toBeNull();
    });
});
