import { prisma } from '@/app/lib/prisma';
import { getFaceSettings } from '@/app/lib/face-settings';
import { getKolkataCalendarYmd, getUtcBoundsForBranchCalendarDay } from '@/app/lib/branch-lock';

export interface WeekSchedule {
  sunday: boolean;
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  saturday: boolean;
}

const DEFAULT_WEEK_SCHEDULE: WeekSchedule = {
  sunday: false,
  monday: true,
  tuesday: true,
  wednesday: true,
  thursday: true,
  friday: true,
  saturday: true,
};

const DAY_KEYS: (keyof WeekSchedule)[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

export async function getWeekConfiguration(branchId: string): Promise<WeekSchedule> {
  const row = await prisma.weekConfiguration.findUnique({ where: { branchId } });
  if (!row) return DEFAULT_WEEK_SCHEDULE;
  return {
    sunday: row.sunday,
    monday: row.monday,
    tuesday: row.tuesday,
    wednesday: row.wednesday,
    thursday: row.thursday,
    friday: row.friday,
    saturday: row.saturday,
  };
}

export async function upsertWeekConfiguration(
  branchId: string,
  schedule: Partial<WeekSchedule>,
  updatedById?: string,
): Promise<WeekSchedule> {
  const current = await getWeekConfiguration(branchId);
  const merged = { ...current, ...schedule };
  const row = await prisma.weekConfiguration.upsert({
    where: { branchId },
    create: { branchId, ...merged, updatedById },
    update: { ...merged, updatedById },
  });
  return {
    sunday: row.sunday,
    monday: row.monday,
    tuesday: row.tuesday,
    wednesday: row.wednesday,
    thursday: row.thursday,
    friday: row.friday,
    saturday: row.saturday,
  };
}

export async function upsertWeekConfigurationForBranches(
  branchIds: string[],
  schedule: WeekSchedule,
  updatedById?: string,
): Promise<void> {
  await prisma.$transaction(
    branchIds.map((branchId) =>
      prisma.weekConfiguration.upsert({
        where: { branchId },
        create: { branchId, ...schedule, updatedById },
        update: { ...schedule, updatedById },
      }),
    ),
  );
}

export async function getHolidaysForBranch(
  branchId: string,
  range?: { from?: Date; to?: Date },
) {
  return prisma.holiday.findMany({
    where: {
      branchId,
      ...(range?.from || range?.to
        ? {
            date: {
              ...(range.from ? { gte: range.from } : {}),
              ...(range.to ? { lte: range.to } : {}),
            },
          }
        : {}),
    },
    orderBy: { date: 'asc' },
  });
}

export async function upsertHoliday(
  branchId: string,
  ymd: string,
  isWorkingDay: boolean,
  reason: string | undefined,
  createdById?: string,
) {
  const { dayStartUtc } = getUtcBoundsForBranchCalendarDay(new Date(`${ymd}T00:00:00+05:30`));
  return prisma.holiday.upsert({
    where: { branchId_date: { branchId, date: dayStartUtc } },
    create: { branchId, date: dayStartUtc, isWorkingDay, reason, createdById },
    update: { isWorkingDay, reason },
  });
}

export async function deleteHoliday(branchId: string, ymd: string) {
  const { dayStartUtc } = getUtcBoundsForBranchCalendarDay(new Date(`${ymd}T00:00:00+05:30`));
  await prisma.holiday.deleteMany({ where: { branchId, date: dayStartUtc } });
}

/**
 * Branch-aware replacement for the old JSON-backed `checkDayAttendanceAllowed`
 * (schedule/dateOverrides now live in `WeekConfiguration`/`Holiday`).
 * `faceAttendanceEnabled` comes from the `FaceAttendanceSetting` table.
 */
export type DayType = 'WORKING' | 'WEEK_OFF' | 'HOLIDAY' | 'WORKING_OVERRIDE';

export async function checkDayAttendanceAllowed(
  date: Date,
  branchId: string,
): Promise<{
  allowed: boolean;
  isWorkingDay: boolean;
  faceAttendanceEnabled: boolean;
  reason?: string;
  dayType: DayType;
  dayNote?: string;
}> {
  const ymd = getKolkataCalendarYmd(date);
  const { dayStartUtc } = getUtcBoundsForBranchCalendarDay(date);
  const { faceAttendanceEnabled } = await getFaceSettings();

  const holiday = await prisma.holiday.findUnique({
    where: { branchId_date: { branchId, date: dayStartUtc } },
  });

  let isWorkingDay: boolean;
  let reason: string | undefined;
  let dayType: DayType;
  let dayNote: string | undefined;

  if (holiday) {
    isWorkingDay = holiday.isWorkingDay;
    dayType = isWorkingDay ? 'WORKING_OVERRIDE' : 'HOLIDAY';
    dayNote = holiday.reason ?? undefined;
    if (!isWorkingDay) {
      reason = holiday.reason
        ? `Today (${ymd}) is a Holiday: ${holiday.reason}. Punch-in is disabled.`
        : `Today (${ymd}) is a Holiday. Punch-in is disabled.`;
    }
  } else {
    const schedule = await getWeekConfiguration(branchId);
    const dayName = DAY_KEYS[date.getDay()];
    isWorkingDay = Boolean(schedule[dayName]);
    dayType = isWorkingDay ? 'WORKING' : 'WEEK_OFF';
    if (!isWorkingDay) {
      const capitalizedDay = dayName.charAt(0).toUpperCase() + dayName.slice(1);
      reason = `Today (${capitalizedDay}) is a Weekly Off. Punch-in is disabled.`;
    }
  }

  if (!faceAttendanceEnabled) {
    return {
      allowed: false,
      isWorkingDay,
      faceAttendanceEnabled: false,
      reason: 'Face attendance is disabled by Admin.',
      dayType,
      dayNote,
    };
  }

  if (!isWorkingDay) {
    return {
      allowed: false,
      isWorkingDay: false,
      faceAttendanceEnabled,
      reason: reason || `Attendance is disabled on ${ymd} by Admin.`,
      dayType,
      dayNote,
    };
  }

  return {
    allowed: true,
    isWorkingDay: true,
    faceAttendanceEnabled: true,
    dayType,
    dayNote,
  };
}
