/**
 * Center meeting-day rule for a first due date — mirrors validateMeetingDay() in
 * app/api/disbursements/bm-disburse/route.ts (daily frequency or no meetingDay = no restriction).
 * Dates are 'YYYY-MM-DD' strings, evaluated as calendar dates (stored as UTC midnight).
 */
const DAY_INDEX: Record<string, number> = {
    SUNDAY: 0, MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6,
};
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The weekday (0-6) the date must fall on, or null when no restriction applies. */
export function requiredMeetingWeekday(meetingDay: string | null | undefined, frequency: string | null | undefined): number | null {
    if (!meetingDay || (frequency ?? 'weekly').toLowerCase() === 'daily') return null;
    return DAY_INDEX[meetingDay.toUpperCase()] ?? null;
}

/** Returns an error message, or null when the date is allowed. */
export function meetingDayError(
    ymd: string,
    meetingDay: string | null | undefined,
    frequency: string | null | undefined
): string | null {
    const required = requiredMeetingWeekday(meetingDay, frequency);
    if (required === null) return null;
    const weekday = new Date(`${ymd}T00:00:00Z`).getUTCDay();
    if (weekday === required) return null;
    return `Due date must fall on center meeting day (${DAY_NAMES[required]}). Selected date is ${DAY_NAMES[weekday]}.`;
}
