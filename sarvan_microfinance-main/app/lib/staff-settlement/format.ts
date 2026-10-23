const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * "2026-09-30" (a date-only value, or an ISO string) -> "Sep 2026". Built from the YYYY-MM slice and a fixed
 * month list, never from Date/Intl: en-IN spells September "Sept", and a Date round-trip can shift the month.
 * The schedule keeps its exact due date; only the display drops the day.
 */
export function formatMonthYear(ymd: string): string {
    const match = /^(\d{4})-(\d{2})/.exec(ymd);
    if (!match) return ymd;
    const month = Number(match[2]);
    return month >= 1 && month <= 12 ? `${MONTHS[month - 1]} ${match[1]}` : ymd;
}

/** "2026-09-25" -> "25 Sep 2026" (fixed month names, like formatMonthYear). */
export function formatDayMonthYear(ymd: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
    if (!match) return ymd;
    const month = Number(match[2]);
    return month >= 1 && month <= 12 ? `${Number(match[3])} ${MONTHS[month - 1]} ${match[1]}` : ymd;
}
