import { addCalendarDaysToYmd, getWeekdayNameInTimeZone, parseDenominationEntryDateUtc } from '@/app/lib/branch-financial-day';

const SUNDAY_WEEKDAY_NAME = 'Sunday';
const MAX_SKIP_DAYS = 7;

export function isSundayYmdInTimeZone(ymd: string, timeZone: string): boolean {
    const instant = parseDenominationEntryDateUtc(ymd);
    return getWeekdayNameInTimeZone(instant, timeZone) === SUNDAY_WEEKDAY_NAME;
}

/**
 * Returns the next calendar YYYY-MM-DD after `fromYmd` that is not a Sunday in `timeZone`.
 * If `fromYmd` itself is Sunday, this returns the next non-Sunday date (typically Monday).
 */
export function nextNonSundayYmd(fromYmd: string, timeZone: string): string {
    let current = fromYmd;
    for (let i = 0; i < MAX_SKIP_DAYS; i += 1) {
        if (!isSundayYmdInTimeZone(current, timeZone)) {
            return current;
        }
        current = addCalendarDaysToYmd(current, 1);
    }
    // Defensive fallback: if timezone data is weird, do not loop forever.
    return current;
}

/**
 * Counts how many EOD closures are required to reach `todayYmd` from `workingDateYmd`,
 * excluding Sundays (EOD not required).
 *
 * Example (IST):
 * - working=Sat, today=Mon => 1 (Sat only; Sun skipped; next becomes Mon)
 */
export function countPendingEodDaysBehind(
    workingDateYmd: string,
    todayYmd: string,
    timeZone: string
): number {
    if (workingDateYmd >= todayYmd) {
        return 0;
    }
    let count = 0;
    let cursor = workingDateYmd;
    for (let i = 0; i < 4000; i += 1) {
        if (cursor >= todayYmd) {
            return count;
        }
        if (!isSundayYmdInTimeZone(cursor, timeZone)) {
            count += 1;
        }
        cursor = addCalendarDaysToYmd(cursor, 1);
    }
    // Should be unreachable; return a safe cap if date range is pathological.
    return count;
}

