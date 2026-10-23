import { prisma } from '@/app/lib/prisma';
import {
  BRANCH_DEFAULT_CLOSE_MINUTES,
  BRANCH_DEFAULT_OPEN_MINUTES,
  BRANCH_LOCK_TIMEZONE,
  computeDefaultWindowForWorkingDate,
} from '@/app/lib/branch-lock';
import {
  addCalendarDaysToYmd,
  getBranchCalendarYmdForInstant,
  isWorkingDateAheadOfBranchCalendarToday,
  parseDenominationEntryDateUtc,
} from '@/app/lib/branch-financial-day';
import { hasBranchLockPolicyColumns } from '@/app/lib/branch-lock-policy-schema';
import { countPendingEodDaysBehind, isSundayYmdInTimeZone, nextNonSundayYmd } from '@/app/lib/eod-working-date-policy';
import { bumpMasterDataVersion } from '@/app/lib/cache/master-data-cache';
import { computeEodChecklist } from '@/app/lib/eod-checklist';

export class EodCloseError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'EodCloseError';
  }
}

/**
 * Performs the actual EOD close for a branch: validates the checklist/denomination
 * one final time, then advances BranchLock.currentWorkingDate (skipping Sundays)
 * and rolls the lock window. This is the single mutation point shared by:
 *  - the Admin direct-close path (app/api/utilities/eod-process POST)
 *  - the AM approve path (app/api/eod-close-requests/[id]/approve POST)
 * Callers must call assertBranchNotLocked(branchId) themselves before invoking this —
 * it is not repeated here so callers can decide their own error response shape for
 * that specific guard.
 */
export async function closeEodForBranch(
  branchId: string,
  user: { userId: string; role?: string }
): Promise<{ nextDate: Date }> {
  const policyColumnsAvailable = await hasBranchLockPolicyColumns();

  const branchLock = policyColumnsAvailable
    ? await prisma.branchLock.findUnique({
        where: { branchId },
        select: {
          currentWorkingDate: true,
          timezone: true,
          lockTime: true,
          isManuallyExtended: true,
          manualOverrideUntil: true,
          manualOverrideByUserId: true,
        },
      })
    : await prisma.branchLock.findUnique({
        where: { branchId },
        select: {
          currentWorkingDate: true,
          lockTime: true,
        },
      });

  if (!branchLock) {
    throw new EodCloseError('Branch lock not found', 404);
  }

  const timezone: string =
    policyColumnsAvailable && 'timezone' in branchLock && typeof branchLock.timezone === 'string' && branchLock.timezone.length > 0
      ? branchLock.timezone
      : BRANCH_LOCK_TIMEZONE;

  if (
    isWorkingDateAheadOfBranchCalendarToday(
      new Date(branchLock.currentWorkingDate),
      new Date(),
      timezone
    )
  ) {
    throw new EodCloseError(
      'EOD already completed for today. The branch working date has moved to the next calendar day.',
      409
    );
  }

  const workingDate = new Date(branchLock.currentWorkingDate);
  const snapshotWorkingAt = branchLock.currentWorkingDate;
  const workingYmd = getBranchCalendarYmdForInstant(
    new Date(branchLock.currentWorkingDate),
    timezone
  );
  const todayYmd = getBranchCalendarYmdForInstant(new Date(), timezone);
  const daysBehind = countPendingEodDaysBehind(workingYmd, todayYmd, timezone);

  // EOD is not required on Sundays
  if (isSundayYmdInTimeZone(workingYmd, timezone)) {
    const nextYmd = nextNonSundayYmd(addCalendarDaysToYmd(workingYmd, 1), timezone);
    const nextDate = parseDenominationEntryDateUtc(nextYmd);
    const nextWindow = computeDefaultWindowForWorkingDate(
      nextDate,
      timezone,
      BRANCH_DEFAULT_OPEN_MINUTES,
      BRANCH_DEFAULT_CLOSE_MINUTES
    );

    const updateResult = policyColumnsAvailable
      ? await prisma.branchLock.updateMany({
          where: { branchId, currentWorkingDate: snapshotWorkingAt },
          data: {
            currentWorkingDate: nextDate,
            lockTime: nextWindow.end,
            defaultOpenMinutes: BRANCH_DEFAULT_OPEN_MINUTES,
            defaultCloseMinutes: BRANCH_DEFAULT_CLOSE_MINUTES,
            effectiveWindowStartAt: nextWindow.start,
            effectiveWindowEndAt: nextWindow.end,
            isManuallyExtended: false,
            manualOverrideUntil: null,
            manualOverrideReason: null,
            manualOverrideByUserId: null,
          },
        })
      : await prisma.branchLock.updateMany({
          where: { branchId, currentWorkingDate: snapshotWorkingAt },
          data: {
            currentWorkingDate: nextDate,
            lockTime: nextWindow.end,
          },
        });

    if (updateResult.count === 0) {
      throw new EodCloseError('Working date changed concurrently. Refresh and try again.', 409);
    }

    return { nextDate };
  }

  const checklistResult = await computeEodChecklist(branchId, workingDate, timezone);
  if (!checklistResult.canCompleteEod) {
    throw new EodCloseError(
      'EOD cannot be closed. Resolve pending checklist issues before proceeding.',
      409
    );
  }

  const nextYmd = nextNonSundayYmd(addCalendarDaysToYmd(workingYmd, 1), timezone);
  const nextDate = parseDenominationEntryDateUtc(nextYmd);
  const nextWindow = computeDefaultWindowForWorkingDate(
    nextDate,
    timezone,
    BRANCH_DEFAULT_OPEN_MINUTES,
    BRANCH_DEFAULT_CLOSE_MINUTES
  );

  // ── Catch-up extension preservation ─────────────────────────────────────────
  // When closing EOD for a past working date (catch-up), the admin's write-window
  // extension MUST survive into the next date's lock so all remaining catch-up
  // days stay writable without requiring another admin action per day.
  const isCatchUp = daysBehind > 0;

  // For the non-policy path (no extended columns): if catching up, keep the
  // existing lockTime (set by admin) instead of overwriting with a historic window end.
  const nonPolicyLockEnd = isCatchUp && branchLock ? branchLock.lockTime : nextWindow.end;

  let updateResult;

  if (policyColumnsAvailable) {
    const extendedLock = branchLock as typeof branchLock & {
      isManuallyExtended?: boolean | null;
      manualOverrideUntil?: Date | null;
      manualOverrideByUserId?: string | null;
    };

    let effectiveLockEnd = nextWindow.end;
    let preservedIsManuallyExtended = false;
    let preservedManualOverrideUntil: Date | null = null;
    let preservedManualOverrideByUserId: string | null = null;

    if (isCatchUp && extendedLock) {
      const nowUtc = new Date();
      const existingOverride = extendedLock.manualOverrideUntil;
      if (
        extendedLock.isManuallyExtended &&
        existingOverride &&
        existingOverride.getTime() > nowUtc.getTime()
      ) {
        // Carry the admin's grant forward to the next catch-up date.
        effectiveLockEnd = existingOverride;
        preservedIsManuallyExtended = true;
        preservedManualOverrideUntil = existingOverride;
        preservedManualOverrideByUserId = extendedLock.manualOverrideByUserId ?? null;
      }
    }

    updateResult = await prisma.branchLock.updateMany({
      where: {
        branchId,
        currentWorkingDate: snapshotWorkingAt,
      },
      data: {
        currentWorkingDate: nextDate,
        lockTime: effectiveLockEnd,
        defaultOpenMinutes: BRANCH_DEFAULT_OPEN_MINUTES,
        defaultCloseMinutes: BRANCH_DEFAULT_CLOSE_MINUTES,
        effectiveWindowStartAt: nextWindow.start,
        effectiveWindowEndAt: effectiveLockEnd,
        isManuallyExtended: preservedIsManuallyExtended,
        manualOverrideUntil: preservedManualOverrideUntil,
        manualOverrideReason: null,
        manualOverrideByUserId: preservedManualOverrideByUserId,
        lastEodClosedAt: new Date(),
        lastEodClosedByUserId: user.userId,
      },
    });
  } else {
    updateResult = await prisma.branchLock.updateMany({
      where: {
        branchId,
        currentWorkingDate: snapshotWorkingAt,
      },
      data: {
        currentWorkingDate: nextDate,
        lockTime: nonPolicyLockEnd,
      },
    });
  }

  if (updateResult.count === 0) {
    const fresh = await prisma.branchLock.findUnique({
      where: { branchId },
      select: { currentWorkingDate: true },
    });
    if (!fresh) {
      throw new EodCloseError('Branch lock not found', 404);
    }
    const priorYmd = getBranchCalendarYmdForInstant(workingDate, timezone);
    const freshYmd = getBranchCalendarYmdForInstant(
      new Date(fresh.currentWorkingDate),
      timezone
    );
    if (freshYmd > priorYmd) {
      throw new EodCloseError('EOD already completed for this working date. Refresh the page.', 409);
    }
    throw new EodCloseError('EOD could not be finalized. Refresh and try again.', 409);
  }

  // First EOD close for a branch flips the cached /api/branches `eodCompleted` flag.
  await bumpMasterDataVersion('branches');
  return { nextDate };
}
