import type { Prisma } from '@prisma/client';
import { parseKolkataAttendanceDateYmd } from '@/app/lib/branch-lock';

// Intentional duplicate of the private helpers in app/lib/actions/demand.ts
// (getMeetingDayName / buildMeetingDayVariantOrFilter). That file is a
// 'use server' actions module, so its synchronous helpers cannot be exported
// as-is (only async Server Actions may be exported from it). Kept in sync
// manually with demand.ts if the meeting-day matching rules change.

export function getMeetingDayName(dateStr: string): string {
  const dayStartKolkata = parseKolkataAttendanceDateYmd(dateStr);
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', timeZone: 'Asia/Kolkata' }).format(dayStartKolkata);
}

export function buildMeetingDayVariantOrFilter(meetingDayName: string): Prisma.CenterWhereInput {
  const canonical = meetingDayName.trim().toLowerCase();
  const VARIANTS_BY_DAY: Record<string, readonly string[]> = {
    sunday: ['Sunday', 'Sun'],
    monday: ['Monday', 'Mon'],
    tuesday: ['Tuesday', 'Tue', 'Tues'],
    wednesday: ['Wednesday', 'Wed'],
    thursday: ['Thursday', 'Thu', 'Thur', 'Thurs'],
    friday: ['Friday', 'Fri'],
    saturday: ['Saturday', 'Sat'],
  };
  const variants = VARIANTS_BY_DAY[canonical] ?? [meetingDayName];
  return {
    OR: variants.map(v => ({
      meetingDay: { equals: v, mode: 'insensitive' as const },
    })),
  };
}
