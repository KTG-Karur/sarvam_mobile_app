import { describe, expect, it } from 'vitest';
import { getKolkataCalendarYmd } from './branch-lock';

/** getKolkataCalendarYmd now reuses one formatter (speed); these pin its output so the date logic is unchanged. */
describe('getKolkataCalendarYmd', () => {
    it.each([
        ['2026-10-13T18:29:59.999Z', '2026-10-13'], // 23:59:59.999 IST
        ['2026-10-13T18:30:00.000Z', '2026-10-14'], // 00:00 IST next day
        ['2026-09-30T18:30:00.000Z', '2026-10-01'],
        ['2026-12-31T20:00:00.000Z', '2027-01-01'], // year rollover
        ['2028-02-28T18:30:00.000Z', '2028-02-29'], // leap day
        ['2026-01-01T00:00:00.000Z', '2026-01-01'],
    ])('%s -> %s', (iso, ymd) => {
        expect(getKolkataCalendarYmd(new Date(iso))).toBe(ymd);
    });

    it('gives the same answer on repeated calls (shared formatter keeps no state)', () => {
        const d = new Date('2026-10-13T18:30:00.000Z');
        const first = getKolkataCalendarYmd(d);
        for (let i = 0; i < 1000; i++) expect(getKolkataCalendarYmd(d)).toBe(first);
    });
});
