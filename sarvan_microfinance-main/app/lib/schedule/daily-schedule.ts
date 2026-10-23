import { addDays } from 'date-fns';
import { getKolkataCalendarYmd } from '@/app/lib/branch-lock';

/**
 * Configuration for daily schedule generation.
 * All fields have sensible defaults for Indian microfinance.
 */
export type DailyScheduleConfig = {
  /** Days after disbursement before first repayment (default: 2) */
  offsetDays?: number;
  /**
   * Days of the week to exclude (0 = Sunday, 6 = Saturday).
   * Default: [0] (Sunday only).
   */
  nonWorkingDays?: number[];
  /** ISO date strings (YYYY-MM-DD) of holidays to skip */
  holidays?: string[];
};

const DEFAULT_OFFSET_DAYS = 2;
const DEFAULT_NON_WORKING_DAYS: number[] = [0]; // Sunday

/**
 * Format a Date to 'YYYY-MM-DD' in IST (Asia/Kolkata) — independent of server timezone.
 * Disbursement dates come from parseKolkataAttendanceDateYmd (T00:00:00+05:30),
 * and addDays preserves the UTC offset, so getKolkataCalendarYmd correctly
 * returns the IST calendar date on any server timezone.
 */
export function toLocalISODate(date: Date): string {
  return getKolkataCalendarYmd(date);
}

/**
 * Check whether a given date falls on a non-working day.
 */
function isNonWorkingDay(
  date: Date,
  nonWorkingDays: number[],
  holidaySet: Set<string>,
): boolean {
  // Derive day-of-week in IST to match the branch calendar, not server-local.
  // getDay() on a UTC-midnight-anchored Date gives wrong results on UTC servers
  // (e.g. Friday IST evening is Thursday UTC+0).
  const istYmd = getKolkataCalendarYmd(date);
  const istDate = new Date(`${istYmd}T00:00:00Z`); // neutral UTC anchor just for getUTCDay()
  const dayOfWeek = istDate.getUTCDay(); // 0=Sun … 6=Sat, aligned to IST calendar day
  if (nonWorkingDays.includes(dayOfWeek)) return true;
  if (holidaySet.has(istYmd)) return true;
  return false;
}

/**
 * Compute the first repayment date by advancing `offsetDays` calendar days
 * from `disbursementDate`, then skipping forward while the result lands on a
 * non-working day or holiday.
 */
export function computeFirstRepaymentDate(
  disbursementDate: Date,
  config: DailyScheduleConfig = {},
): Date {
  const offsetDays = config.offsetDays ?? DEFAULT_OFFSET_DAYS;
  const nonWorkingDays = config.nonWorkingDays ?? DEFAULT_NON_WORKING_DAYS;
  const holidaySet = new Set(config.holidays ?? []);

  let candidate = addDays(disbursementDate, offsetDays);

  while (isNonWorkingDay(candidate, nonWorkingDays, holidaySet)) {
    candidate = addDays(candidate, 1);
  }

  return candidate;
}

/**
 * Advance from `current` to the next valid working day.
 */
function nextWorkingDay(
  current: Date,
  nonWorkingDays: number[],
  holidaySet: Set<string>,
): Date {
  let next = addDays(current, 1);
  while (isNonWorkingDay(next, nonWorkingDays, holidaySet)) {
    next = addDays(next, 1);
  }
  return next;
}

export type DailyScheduleDate = {
  installmentNo: number;
  date: Date;
  isoDate: string;
};

export type SkippedDay = {
  date: string;
  reason: 'non_working_day' | 'holiday';
};

export type DailyScheduleResult = {
  dates: DailyScheduleDate[];
  skippedDays: SkippedDay[];
  config: {
    offsetDays: number;
    nonWorkingDays: number[];
    holidayCount: number;
  };
};

/**
 * Generate an array of valid repayment dates for a daily-frequency loan.
 *
 * Rules:
 *  1. First repayment = disbursementDate + offsetDays (default 2), skipping
 *     any non-working days / holidays that the computed date falls on.
 *  2. Each subsequent date is the next calendar day that is NOT a
 *     non-working day or holiday.
 *  3. Exactly `numberOfDues` dates are produced.
 *
 * Complexity: O(numberOfDues + skipped days) — iterative, no recursion.
 */
export function generateDailyRepaymentDates(
  disbursementDate: Date,
  numberOfDues: number,
  config: DailyScheduleConfig = {},
): DailyScheduleResult {
  const offsetDays = config.offsetDays ?? DEFAULT_OFFSET_DAYS;
  const nonWorkingDays = config.nonWorkingDays ?? DEFAULT_NON_WORKING_DAYS;
  const holidays = config.holidays ?? [];
  const holidaySet = new Set(holidays);

  const dates: DailyScheduleDate[] = [];
  const skippedDays: SkippedDay[] = [];

  let currentDate = addDays(disbursementDate, offsetDays);

  const MAX_SAFETY_ITERATIONS = numberOfDues * 3 + 365;
  let iterations = 0;

  while (dates.length < numberOfDues && iterations < MAX_SAFETY_ITERATIONS) {
    iterations++;

    if (isNonWorkingDay(currentDate, nonWorkingDays, holidaySet)) {
      const istYmd = toLocalISODate(currentDate); // already IST-aware
      const istDate = new Date(`${istYmd}T00:00:00Z`);
      const dayOfWeek = istDate.getUTCDay(); // IST-aligned day of week
      skippedDays.push({
        date: istYmd,
        reason: nonWorkingDays.includes(dayOfWeek)
          ? 'non_working_day'
          : 'holiday',
      });
      currentDate = addDays(currentDate, 1);
      continue;
    }

    dates.push({
      installmentNo: dates.length + 1,
      date: new Date(currentDate),
      isoDate: toLocalISODate(currentDate),
    });

    if (dates.length < numberOfDues) {
      currentDate = addDays(currentDate, 1);
    }
  }

  return {
    dates,
    skippedDays,
    config: {
      offsetDays,
      nonWorkingDays,
      holidayCount: holidays.length,
    },
  };
}
