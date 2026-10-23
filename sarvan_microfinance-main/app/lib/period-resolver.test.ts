import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolvePeriod } from '@/app/lib/period-resolver';

function at(iso: string) {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(iso));
}

afterEach(() => vi.useRealTimers());

describe('resolvePeriod', () => {
    it('TODAY resolves to the current IST calendar day', () => {
        at('2026-09-19T04:30:00Z'); // 10:00 IST
        const p = resolvePeriod({ period: 'TODAY' });
        expect(p.fromDateStr).toBe('2026-09-19');
        expect(p.tillDateStr).toBe('2026-09-19');
        expect(p.fromDateUtc.toISOString()).toBe('2026-09-18T18:30:00.000Z');
        expect(p.tillDateExclusiveUtc.toISOString()).toBe('2026-09-19T18:30:00.000Z');
    });

    it('uses IST, not UTC, for the day boundary (late-evening UTC is already tomorrow in IST)', () => {
        at('2026-09-19T20:00:00Z'); // 01:30 IST on the 20th
        expect(resolvePeriod({ period: 'TODAY' }).fromDateStr).toBe('2026-09-20');
    });

    it('THIS_WEEK is Monday-Sunday (Saturday input)', () => {
        at('2026-09-19T04:30:00Z'); // Saturday
        const p = resolvePeriod({ period: 'THIS_WEEK' });
        expect(p.fromDateStr).toBe('2026-09-14');
        expect(p.tillDateStr).toBe('2026-09-20');
    });

    it('THIS_WEEK treats Sunday as the last day of the week, not the first', () => {
        at('2026-09-20T04:30:00Z'); // Sunday
        const p = resolvePeriod({ period: 'THIS_WEEK' });
        expect(p.fromDateStr).toBe('2026-09-14');
        expect(p.tillDateStr).toBe('2026-09-20');
    });

    it('THIS_WEEK can span a month boundary', () => {
        at('2026-09-30T04:30:00Z'); // Wednesday
        const p = resolvePeriod({ period: 'THIS_WEEK' });
        expect(p.fromDateStr).toBe('2026-09-28');
        expect(p.tillDateStr).toBe('2026-10-04');
    });

    it('THIS_MONTH covers the whole IST month', () => {
        at('2026-09-19T04:30:00Z');
        const p = resolvePeriod({ period: 'THIS_MONTH' });
        expect(p.fromDateStr).toBe('2026-09-01');
        expect(p.tillDateStr).toBe('2026-09-30');
        expect(p.fromDateUtc.toISOString()).toBe('2026-08-31T18:30:00.000Z');
        expect(p.tillDateExclusiveUtc.toISOString()).toBe('2026-09-30T18:30:00.000Z');
    });

    it('THIS_MONTH handles a leap-year February', () => {
        at('2028-02-10T04:30:00Z');
        expect(resolvePeriod({ period: 'THIS_MONTH' }).tillDateStr).toBe('2028-02-29');
    });

    it('THIS_YEAR rolls over at IST midnight, not UTC midnight', () => {
        at('2026-12-31T19:00:00Z'); // 00:30 IST on 1 Jan 2027
        const p = resolvePeriod({ period: 'THIS_YEAR' });
        expect(p.fromDateStr).toBe('2027-01-01');
        expect(p.tillDateStr).toBe('2027-12-31');
    });

    it('CUSTOM accepts a valid range (inclusive of the till date)', () => {
        const p = resolvePeriod({ period: 'CUSTOM', fromDate: '2026-09-01', tillDate: '2026-09-18' });
        expect(p.type).toBe('CUSTOM');
        expect(p.fromDateUtc.toISOString()).toBe('2026-08-31T18:30:00.000Z');
        expect(p.tillDateExclusiveUtc.toISOString()).toBe('2026-09-18T18:30:00.000Z');
    });

    it('CUSTOM allows a single-day range', () => {
        const p = resolvePeriod({ period: 'CUSTOM', fromDate: '2026-09-18', tillDate: '2026-09-18' });
        expect(p.fromDateStr).toBe(p.tillDateStr);
    });

    it('CUSTOM requires both dates', () => {
        expect(() => resolvePeriod({ period: 'CUSTOM', fromDate: '2026-09-01' })).toThrow(/required for CUSTOM/);
        expect(() => resolvePeriod({ period: 'CUSTOM' })).toThrow(/required for CUSTOM/);
    });

    it('CUSTOM rejects fromDate after tillDate', () => {
        expect(() => resolvePeriod({ period: 'CUSTOM', fromDate: '2026-09-18', tillDate: '2026-09-01' })).toThrow(/cannot be after/);
    });

    it('rejects a missing or unknown period', () => {
        expect(() => resolvePeriod({ period: null })).toThrow(/period must be one of/);
        expect(() => resolvePeriod({ period: 'LAST_MONTH' })).toThrow(/period must be one of/);
    });

    it('is case-insensitive on the period value', () => {
        at('2026-09-19T04:30:00Z');
        expect(resolvePeriod({ period: 'this_month' }).type).toBe('THIS_MONTH');
    });
});
