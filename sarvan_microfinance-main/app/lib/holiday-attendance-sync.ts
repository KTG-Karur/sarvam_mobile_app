import { prisma } from '@/app/lib/prisma';
import { getUtcBoundsForBranchCalendarDay } from '@/app/lib/branch-lock';

/**
 * Keeps per-employee `Attendance` rows in step with the branch Holiday calendar,
 * since payroll, reports and the mobile app read `Attendance.isHoliday` / `HOLIDAY`.
 * Employees on an APPROVED whole-day leave are left untouched (same rule the old
 * register "Mark As Holiday" toggle applied).
 */
export async function syncHolidayAttendance(branchId: string, ymd: string, isHoliday: boolean) {
  const { dayStartUtc, dayEndUtc } = getUtcBoundsForBranchCalendarDay(new Date(`${ymd}T12:00:00+05:30`));

  if (!isHoliday) {
    await prisma.$transaction([
      prisma.attendance.deleteMany({
        where: { branchId, date: { gte: dayStartUtc, lte: dayEndUtc }, isHoliday: true, checkIn: null },
      }),
      prisma.attendance.updateMany({
        where: { branchId, date: { gte: dayStartUtc, lte: dayEndUtc }, isHoliday: true, checkIn: { not: null } },
        data: { isHoliday: false, status: 'PRESENT' },
      }),
    ]);
    return;
  }

  const employees = await prisma.user.findMany({
    where: { isActive: true, branchId },
    select: { id: true },
  });
  const ids = employees.map((e) => e.id);

  const leaves = await prisma.leaveApplication.findMany({
    where: { employeeId: { in: ids }, status: 'APPROVED', isHalfDay: false },
    select: { employeeId: true, fromDate: true, toDate: true },
  });
  const onLeave = new Set<string>();
  for (const lv of leaves) {
    const from = getUtcBoundsForBranchCalendarDay(lv.fromDate).dayStartUtc.getTime();
    const to = getUtcBoundsForBranchCalendarDay(lv.toDate).dayStartUtc.getTime();
    if (dayStartUtc.getTime() >= from && dayStartUtc.getTime() <= to) onLeave.add(lv.employeeId);
  }

  const existing = await prisma.attendance.findMany({
    where: { userId: { in: ids }, date: { gte: dayStartUtc, lte: dayEndUtc } },
    select: { id: true, userId: true },
  });
  const existingUserIds = new Set(existing.map((r) => r.userId));

  const toUpdate = existing.filter((r) => !onLeave.has(r.userId)).map((r) => r.id);
  const toInsert = ids.filter((id) => !existingUserIds.has(id) && !onLeave.has(id));

  await prisma.$transaction([
    prisma.attendance.updateMany({
      where: { id: { in: toUpdate } },
      data: { status: 'HOLIDAY', isHoliday: true },
    }),
    prisma.attendance.createMany({
      data: toInsert.map((userId) => ({
        userId,
        branchId,
        date: dayStartUtc,
        status: 'HOLIDAY' as const,
        isHoliday: true,
      })),
    }),
  ]);
}
