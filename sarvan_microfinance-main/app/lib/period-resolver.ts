import { getKolkataCalendarYmd, getUtcBoundsForBranchCalendarDay } from '@/app/lib/branch-lock';

export type PeriodType = 'TODAY' | 'THIS_WEEK' | 'THIS_MONTH' | 'THIS_YEAR' | 'CUSTOM';

export type ResolvedPeriod = {
    type: PeriodType;
    fromDateUtc: Date;
    tillDateExclusiveUtc: Date;
    fromDateStr: string;
    tillDateStr: string;
};

const PERIOD_TYPES: PeriodType[] = ['TODAY', 'THIS_WEEK', 'THIS_MONTH', 'THIS_YEAR', 'CUSTOM'];

function dayBoundsUtc(ymd: string): { startUtc: Date; endExclusiveUtc: Date } {
    const startUtc = new Date(`${ymd}T00:00:00+05:30`);
    const { dayEndUtc } = getUtcBoundsForBranchCalendarDay(startUtc);
    return { startUtc, endExclusiveUtc: new Date(dayEndUtc.getTime() + 1) };
}

function addDaysToYmd(ymd: string, days: number): string {
    const { startUtc } = dayBoundsUtc(ymd);
    return getKolkataCalendarYmd(new Date(startUtc.getTime() + days * 24 * 60 * 60 * 1000 + 12 * 60 * 60 * 1000));
}

/**
 * Resolves a TODAY / THIS_WEEK / THIS_MONTH / THIS_YEAR / CUSTOM period into
 * IST calendar-day UTC bounds. Shared by every new /api/hr/reports/* route so
 * date-range math is computed once, server-side, in IST — never left to the
 * frontend and never accidentally using server-local time.
 *
 * Throws a plain Error (caught by the route's existing try/catch → errorResponse)
 * on missing/invalid input.
 */
export function resolvePeriod(input: {
    period: string | null | undefined;
    fromDate?: string | null;
    tillDate?: string | null;
}): ResolvedPeriod {
    const period = (input.period || '').toUpperCase() as PeriodType;
    if (!PERIOD_TYPES.includes(period)) {
        throw new Error('period must be one of TODAY, THIS_WEEK, THIS_MONTH, THIS_YEAR, CUSTOM');
    }

    const todayYmd = getKolkataCalendarYmd(new Date());

    if (period === 'TODAY') {
        const { startUtc, endExclusiveUtc } = dayBoundsUtc(todayYmd);
        return { type: period, fromDateUtc: startUtc, tillDateExclusiveUtc: endExclusiveUtc, fromDateStr: todayYmd, tillDateStr: todayYmd };
    }

    if (period === 'THIS_WEEK') {
        const { startUtc: todayStart } = dayBoundsUtc(todayYmd);
        // +12h lands mid-day IST, so the UTC calendar date equals the IST calendar date.
        const weekdayIndex = (new Date(todayStart.getTime() + 12 * 60 * 60 * 1000).getUTCDay() + 6) % 7; // 0=Mon..6=Sun
        const mondayYmd = addDaysToYmd(todayYmd, -weekdayIndex);
        const sundayYmd = addDaysToYmd(mondayYmd, 6);
        const { startUtc } = dayBoundsUtc(mondayYmd);
        const { endExclusiveUtc } = dayBoundsUtc(sundayYmd);
        return { type: period, fromDateUtc: startUtc, tillDateExclusiveUtc: endExclusiveUtc, fromDateStr: mondayYmd, tillDateStr: sundayYmd };
    }

    if (period === 'THIS_MONTH') {
        const [y, m] = todayYmd.split('-').map(Number);
        const fromYmd = `${y}-${String(m).padStart(2, '0')}-01`;
        const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
        const tillYmd = `${y}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        const { startUtc } = dayBoundsUtc(fromYmd);
        const { endExclusiveUtc } = dayBoundsUtc(tillYmd);
        return { type: period, fromDateUtc: startUtc, tillDateExclusiveUtc: endExclusiveUtc, fromDateStr: fromYmd, tillDateStr: tillYmd };
    }

    if (period === 'THIS_YEAR') {
        const y = Number(todayYmd.split('-')[0]);
        const fromYmd = `${y}-01-01`;
        const tillYmd = `${y}-12-31`;
        const { startUtc } = dayBoundsUtc(fromYmd);
        const { endExclusiveUtc } = dayBoundsUtc(tillYmd);
        return { type: period, fromDateUtc: startUtc, tillDateExclusiveUtc: endExclusiveUtc, fromDateStr: fromYmd, tillDateStr: tillYmd };
    }

    // CUSTOM
    if (!input.fromDate || !input.tillDate) {
        throw new Error('fromDate and tillDate are required for CUSTOM period');
    }
    if (input.fromDate > input.tillDate) {
        throw new Error('fromDate cannot be after tillDate');
    }
    const { startUtc } = dayBoundsUtc(input.fromDate);
    const { endExclusiveUtc } = dayBoundsUtc(input.tillDate);
    return { type: period, fromDateUtc: startUtc, tillDateExclusiveUtc: endExclusiveUtc, fromDateStr: input.fromDate, tillDateStr: input.tillDate };
}
