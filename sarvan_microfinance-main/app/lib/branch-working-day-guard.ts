import { prisma } from '@/app/lib/prisma';
import { BRANCH_LOCK_TIMEZONE } from '@/app/lib/branch-lock';
import { getBranchCalendarDayHalfOpenUtc } from '@/app/lib/branch-financial-day';
import { isHeadOfficeBranch } from '@/app/lib/head-office-branch';

export type BranchWorkingDayWindow = {
  branchId: string;
  workingDateYmd: string;
  branchCalendarTimeZone: string;
  dayStartUtc: Date;
  dayEndExclusiveUtc: Date;
};

export async function getBranchWorkingDayWindow(params: {
  branchId: string;
}): Promise<BranchWorkingDayWindow> {
  if (await isHeadOfficeBranch(params.branchId)) {
    const { workingDateYmd, dayStartUtc, dayEndExclusiveUtc } = getBranchCalendarDayHalfOpenUtc(
      new Date(),
      BRANCH_LOCK_TIMEZONE
    );
    return {
      branchId: params.branchId,
      workingDateYmd,
      branchCalendarTimeZone: BRANCH_LOCK_TIMEZONE,
      dayStartUtc,
      dayEndExclusiveUtc,
    };
  }

  const lock = await prisma.branchLock.findUnique({
    where: { branchId: params.branchId },
    select: { currentWorkingDate: true, timezone: true },
  });

  if (!lock) {
    throw new Error('Branch lock not found');
  }

  const tz = lock.timezone && lock.timezone.trim().length > 0 ? lock.timezone : BRANCH_LOCK_TIMEZONE;
  const { workingDateYmd, dayStartUtc, dayEndExclusiveUtc } = getBranchCalendarDayHalfOpenUtc(
    new Date(lock.currentWorkingDate),
    tz
  );

  return {
    branchId: params.branchId,
    workingDateYmd,
    branchCalendarTimeZone: tz,
    dayStartUtc,
    dayEndExclusiveUtc,
  };
}

export function isInstantWithinWindow(instantUtc: Date, window: BranchWorkingDayWindow): boolean {
  return instantUtc >= window.dayStartUtc && instantUtc < window.dayEndExclusiveUtc;
}

