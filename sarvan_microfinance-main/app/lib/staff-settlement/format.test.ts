import { describe, expect, it } from 'vitest';
import { formatMonthYear } from './format';

describe('formatMonthYear', () => {
    it('shows only the month and year, with a fixed three-letter month name', () => {
        expect(formatMonthYear('2026-09-30')).toBe('Sep 2026'); // not "Sept"
        expect(formatMonthYear('2026-10-30')).toBe('Oct 2026');
        expect(formatMonthYear('2026-11-01')).toBe('Nov 2026');
        expect(formatMonthYear('2026-12-31')).toBe('Dec 2026');
        expect(formatMonthYear('2027-01-30')).toBe('Jan 2027');
        expect(formatMonthYear('2027-02-28')).toBe('Feb 2027');
    });

    it('does not shift the month around a timezone boundary, and accepts an ISO timestamp', () => {
        expect(formatMonthYear('2026-09-01')).toBe('Sep 2026');
        expect(formatMonthYear('2026-09-30T18:30:00.000Z')).toBe('Sep 2026');
    });

    it('leaves an unrecognised value untouched', () => {
        expect(formatMonthYear('')).toBe('');
        expect(formatMonthYear('2026-13-01')).toBe('2026-13-01');
    });
});
