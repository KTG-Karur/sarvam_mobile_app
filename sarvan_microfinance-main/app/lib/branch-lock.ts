import { NextResponse } from 'next/server';

const IST_OFFSET_MINUTES = 330;
/** Branch calendar timezone for lock windows (IST). */
export const BRANCH_LOCK_TIMEZONE = 'Asia/Kolkata';
const DEFAULT_TIMEZONE = BRANCH_LOCK_TIMEZONE;
/** Fixed product default: 09:00 branch-local (minutes from midnight). */
export const BRANCH_DEFAULT_OPEN_MINUTES = 540;
/** Fixed product default: 18:00 branch-local (minutes from midnight). */
export const BRANCH_DEFAULT_CLOSE_MINUTES = 1080;

function startOfDayWithOffset(date: Date, offsetMinutes: number): Date {
    const utc = date.getTime() + date.getTimezoneOffset() * 60000;
    const shifted = new Date(utc + offsetMinutes * 60000);
    shifted.setHours(0, 0, 0, 0);
    const shiftedUtc = shifted.getTime() - offsetMinutes * 60000;
    return new Date(shiftedUtc);
}

function addMinutes(base: Date, minutes: number): Date {
    return new Date(base.getTime() + minutes * 60000);
}

const CALENDAR_DAY_MS = 24 * 60 * 60 * 1000;

// Built once: creating an Intl.DateTimeFormat is far more expensive than formatting with it, and this function runs
// per installment / transaction in the DCB, incentive and payroll calculations (tens of thousands of calls).
const KOLKATA_YMD_FORMATTER = new Intl.DateTimeFormat('en-CA', {
    timeZone: DEFAULT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
});

/** Calendar date (YYYY-MM-DD) for `referenceDate` in Asia/Kolkata — independent of server TZ. */
export function getKolkataCalendarYmd(referenceDate: Date): string {
    return KOLKATA_YMD_FORMATTER.format(referenceDate);
}

/**
 * UTC instants for the full calendar day in the branch timezone (default Asia/Kolkata).
 * Uses explicit `+05:30` parsing so results match on any Node server timezone (unlike
 * {@link startOfDayWithOffset}, which mixes `getTimezoneOffset` + local `setHours`).
 */
export function getUtcBoundsForBranchCalendarDay(
    referenceDate: Date,
    timezone: string = DEFAULT_TIMEZONE
): { dayStartUtc: Date; dayEndUtc: Date } {
    if (timezone === DEFAULT_TIMEZONE) {
        const ymd = getKolkataCalendarYmd(referenceDate);
        const dayStartUtc = new Date(`${ymd}T00:00:00+05:30`);
        const dayEndUtc = new Date(dayStartUtc.getTime() + CALENDAR_DAY_MS - 1);
        return { dayStartUtc, dayEndUtc };
    }
    const dayStartUtc = startOfDayWithOffset(referenceDate, IST_OFFSET_MINUTES);
    const dayEndUtc = new Date(dayStartUtc.getTime() + CALENDAR_DAY_MS - 1);
    return { dayStartUtc, dayEndUtc };
}

/**
 * Canonical UTC instant for payroll/EOD attendance `date` when the user picks `YYYY-MM-DD`
 * as a business day in Asia/Kolkata (matches {@link getUtcBoundsForBranchCalendarDay} start).
 */
/** Use with `dayStartUtc` for half-open DB ranges: `date >= dayStartUtc && date < end`. */
export function getKolkataDayEndExclusiveUtc(dayStartUtc: Date): Date {
    return new Date(dayStartUtc.getTime() + CALENDAR_DAY_MS);
}

export function parseKolkataAttendanceDateYmd(ymd: string): Date {
    const trimmed = ymd.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        throw new Error(`Invalid attendance date (expected YYYY-MM-DD): ${ymd}`);
    }
    return new Date(`${trimmed}T00:00:00+05:30`);
}

const CALENDAR_YMD_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `transactionDate` for repayments: plain `YYYY-MM-DD` from the UI is start-of-day Asia/Kolkata
 * (aligned with demand collection POST and demand-sheet day bounds). Other strings use `Date` parsing.
 */
export function transactionDateFromUserCollectionInput(collectionDate: string | undefined | null): Date {
    const t = collectionDate?.trim();
    if (t && CALENDAR_YMD_REGEX.test(t)) {
        return parseKolkataAttendanceDateYmd(t);
    }
    if (t) {
        return new Date(t);
    }
    return new Date();
}

export function computeDefaultWindowForWorkingDate(
    workingDate: Date,
    timezone: string,
    openMinutes: number,
    closeMinutes: number
): { start: Date; end: Date } {
    // Uses the explicit `+05:30`-parsed day start (see getUtcBoundsForBranchCalendarDay) rather
    // than startOfDayWithOffset, which mixes the Node process's local getTimezoneOffset() with a
    // fixed IST offset — correct only when the server host's OS timezone happens to be UTC, and
    // otherwise double-applies the offset, shifting the whole open/close window by that amount
    // (e.g. a server host set to Asia/Kolkata closes the write window ~5.5h early).
    const { dayStartUtc } = getUtcBoundsForBranchCalendarDay(workingDate, timezone);

    return {
        start: addMinutes(dayStartUtc, openMinutes),
        end: addMinutes(dayStartUtc, closeMinutes),
    };
}

/**
 * Business-hours write-window enforcement is intentionally disabled — employees may
 * submit collections, disbursements, and other branch-scoped mutations at any time of
 * day, not just within the branch's configured open/close window. The "Extend Branch
 * Lock" admin page (and its manual-override workflow) was retired for the same reason
 * and replaced with a read-only "Branch Working Date" viewer — see
 * components/branch/BranchWorkingDateClient.tsx. This function is kept (rather than
 * removed) purely so the ~25 call sites that already guard mutations with it don't need
 * individual edits; it now always allows the request through.
 */
export async function assertBranchNotLocked(
    _branchId: string
): Promise<NextResponse | null> {
    return null;
}
