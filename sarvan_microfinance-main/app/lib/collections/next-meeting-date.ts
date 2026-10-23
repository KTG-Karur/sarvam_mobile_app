import { addDays } from 'date-fns';

// Client-safe (no `prisma`/`next/server`) duplicate of the IST weekday-name
// technique in `getMeetingDayName` (app/lib/collections/meeting-day.ts), which
// cannot be imported here because it transitively pulls in `prisma` via
// `app/lib/branch-lock.ts`. This module must be importable from 'use client'
// components (e.g. CenterList.tsx) with no extra API round-trip.

const VARIANTS_BY_DAY: Record<string, string> = {
    sunday: 'Sunday',
    sun: 'Sunday',
    monday: 'Monday',
    mon: 'Monday',
    tuesday: 'Tuesday',
    tue: 'Tuesday',
    tues: 'Tuesday',
    wednesday: 'Wednesday',
    wed: 'Wednesday',
    thursday: 'Thursday',
    thu: 'Thursday',
    thur: 'Thursday',
    thurs: 'Thursday',
    friday: 'Friday',
    fri: 'Friday',
    saturday: 'Saturday',
    sat: 'Saturday',
};

export function normalizeMeetingDayName(raw?: string | null): string | null {
    if (!raw) return null;
    const key = raw.trim().toLowerCase();
    return VARIANTS_BY_DAY[key] ?? null;
}

export function toIstWeekdayName(date: Date): string {
    return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' }).format(date);
}

export function toIstYmd(date: Date): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(date);
}

export function computeNextMeetingDateYmd(
    meetingDay: string | null | undefined,
    referenceDate: Date
): string | null {
    const canonical = normalizeMeetingDayName(meetingDay);
    if (!canonical) return null;

    let candidate = referenceDate;
    for (let i = 0; i < 7; i++) {
        if (toIstWeekdayName(candidate) === canonical) {
            return toIstYmd(candidate);
        }
        candidate = addDays(candidate, 1);
    }
    return null;
}

export function formatYmdToDmy(ymd: string): string {
    const [year, month, day] = ymd.split('-');
    return `${day}/${month}/${year}`;
}
