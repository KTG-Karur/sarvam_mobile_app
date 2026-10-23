import {
    getKolkataCalendarYmd,
    getKolkataDayEndExclusiveUtc,
    getUtcBoundsForBranchCalendarDay,
} from '@/app/lib/branch-lock';

export type BranchCalendarDayHalfOpen = {
    /** YYYY-MM-DD for the branch calendar day (branch timezone). */
    workingDateYmd: string;
    /** Inclusive UTC start of the branch calendar day. */
    dayStartUtc: Date;
    /** Exclusive UTC end (first instant of the next branch calendar day). */
    dayEndExclusiveUtc: Date;
};

/**
 * Calendar date string (YYYY-MM-DD) for an instant in a given IANA timezone.
 */
export function getCalendarYmdInTimeZone(instant: Date, timeZone: string): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(instant);
}

/** Calendar YYYY-MM-DD for an instant in the branch business timezone. */
export function getBranchCalendarYmdForInstant(instant: Date, branchCalendarTimeZone: string): string {
    return branchCalendarTimeZone === 'Asia/Kolkata'
        ? getKolkataCalendarYmd(instant)
        : getCalendarYmdInTimeZone(instant, branchCalendarTimeZone);
}

/**
 * True when branch lock `currentWorkingDate` is a calendar day strictly after "today"
 * in the branch timezone (EOD has rolled the business day forward vs wall-clock calendar).
 */
export function isWorkingDateAheadOfBranchCalendarToday(
    branchWorkingInstant: Date,
    nowUtc: Date,
    branchCalendarTimeZone: string
): boolean {
    const todayYmd = getBranchCalendarYmdForInstant(nowUtc, branchCalendarTimeZone);
    const workingYmd = getBranchCalendarYmdForInstant(branchWorkingInstant, branchCalendarTimeZone);
    return workingYmd > todayYmd;
}

/**
 * Full English weekday name ("Monday", …) for an instant in the branch timezone.
 * Matches typical `Center.meetingDay` values from collection flows.
 */
export function getWeekdayNameInTimeZone(instant: Date, timeZone: string): string {
    return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone }).format(instant);
}

/**
 * Half-open UTC range [dayStartUtc, dayEndExclusiveUtc) for the branch calendar day
 * that contains `processDate`, resolved in `branchCalendarTimeZone`.
 * Use for loan transaction and cash-credit queries so results are identical on any server TZ.
 */
export function getBranchCalendarDayHalfOpenUtc(
    processDate: Date,
    branchCalendarTimeZone: string
): BranchCalendarDayHalfOpen {
    const { dayStartUtc } = getUtcBoundsForBranchCalendarDay(processDate, branchCalendarTimeZone);
    const dayEndExclusiveUtc = getKolkataDayEndExclusiveUtc(dayStartUtc);
    const workingDateYmd =
        branchCalendarTimeZone === 'Asia/Kolkata'
            ? getKolkataCalendarYmd(processDate)
            : getCalendarYmdInTimeZone(processDate, branchCalendarTimeZone);

    return {
        workingDateYmd,
        dayStartUtc,
        dayEndExclusiveUtc,
    };
}

/**
 * Prisma `@db.Date` value for a business YYYY-MM-DD (UTC midnight anchor — matches
 * denomination entry API and PostgreSQL DATE storage).
 */
export function parseDenominationEntryDateUtc(ymd: string): Date {
    const trimmed = ymd.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        throw new Error(`Invalid date (expected YYYY-MM-DD): ${ymd}`);
    }
    return new Date(`${trimmed}T00:00:00.000Z`);
}

/**
 * Add calendar days to a YYYY-MM-DD string using UTC date arithmetic (safe on any server TZ).
 */
export function addCalendarDaysToYmd(ymd: string, deltaDays: number): string {
    const trimmed = ymd.trim();
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
    if (!m) {
        throw new Error(`Invalid YMD: ${ymd}`);
    }
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const next = new Date(Date.UTC(y, mo - 1, d + deltaDays));
    const yy = next.getUTCFullYear();
    const mm = String(next.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(next.getUTCDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
}

/** Today's calendar date in the branch timezone, as UTC midnight anchor for `currentWorkingDate`. */
export function branchCalendarTodayUtcAnchor(branchCalendarTimeZone: string): Date {
    const ymd = getBranchCalendarYmdForInstant(new Date(), branchCalendarTimeZone);
    return parseDenominationEntryDateUtc(ymd);
}

/**
 * Resolves denomination entryDate Date from branch working-date instant + timezone:
 * same calendar day as {@link getBranchCalendarDayHalfOpenUtc}.
 */
export function denominationEntryDateFromWorkingInstant(
    processDate: Date,
    branchCalendarTimeZone: string
): Date {
    const { workingDateYmd } = getBranchCalendarDayHalfOpenUtc(processDate, branchCalendarTimeZone);
    return parseDenominationEntryDateUtc(workingDateYmd);
}

/**
 * Half-open UTC range [monthStartUtc, monthEndExclusiveUtc) for the Asia/Kolkata calendar
 * month containing `ymd` (YYYY-MM-DD). Uses the same explicit `+05:30` anchor as
 * {@link getUtcBoundsForBranchCalendarDay} so results are stable on any server TZ.
 */
export function getKolkataMonthHalfOpenUtc(ymd: string): { monthStartUtc: Date; monthEndExclusiveUtc: Date } {
    const trimmed = ymd.trim();
    const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(trimmed);
    if (!m) {
        throw new Error(`Invalid YMD (expected YYYY-MM-DD): ${ymd}`);
    }
    const year = Number(m[1]);
    const month = Number(m[2]);
    const monthStartUtc = new Date(`${year}-${String(month).padStart(2, '0')}-01T00:00:00+05:30`);
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const monthEndExclusiveUtc = new Date(`${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00+05:30`);
    return { monthStartUtc, monthEndExclusiveUtc };
}
