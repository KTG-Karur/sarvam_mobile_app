import { getUtcBoundsForBranchCalendarDay } from '@/app/lib/branch-lock';

/**
 * IST calendar-day bounds for a `YYYY-MM-DD` (or ISO) filter value, for TIMESTAMP columns.
 * `new Date(to)` alone is midnight UTC, which drops the whole "To" day from a `lte` filter.
 */
function toDay(value: string): Date {
    const ymd = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0];
    return ymd ? new Date(`${ymd}T00:00:00+05:30`) : new Date(value);
}

export function istDayStart(value: string): Date {
    return getUtcBoundsForBranchCalendarDay(toDay(value)).dayStartUtc;
}

export function istDayEnd(value: string): Date {
    return getUtcBoundsForBranchCalendarDay(toDay(value)).dayEndUtc;
}
