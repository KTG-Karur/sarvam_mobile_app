import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import {
  assertBranchNotLocked,
  BRANCH_DEFAULT_CLOSE_MINUTES,
  BRANCH_DEFAULT_OPEN_MINUTES,
  BRANCH_LOCK_TIMEZONE,
  computeDefaultWindowForWorkingDate,
} from '@/app/lib/branch-lock';
import {
  branchCalendarTodayUtcAnchor,
  getBranchCalendarYmdForInstant,
  isWorkingDateAheadOfBranchCalendarToday,
  parseDenominationEntryDateUtc,
} from '@/app/lib/branch-financial-day';
import { hasBranchLockPolicyColumns } from '@/app/lib/branch-lock-policy-schema';
import { resolveEodViewBranchId } from '@/app/lib/denomination-entry';
import { countPendingEodDaysBehind } from '@/app/lib/eod-working-date-policy';
import { computeEodChecklist } from '@/app/lib/eod-checklist';
import { closeEodForBranch, EodCloseError } from '@/app/lib/eod-close';

const EOD_PROCESS_ROLES = ['BRANCH_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'] as const;
// AREA_MANAGER can only view EOD status — AM no longer has an approval role in
// closing EOD; BRANCH_MANAGER closes directly via POST below, same as Admin.
const EOD_PROCESS_VIEW_ROLES = [...EOD_PROCESS_ROLES, 'AREA_MANAGER'] as const;
const EOD_PROCESS_CLOSE_ROLES = EOD_PROCESS_ROLES;

export async function GET(req: NextRequest) {
  return withRole([...EOD_PROCESS_VIEW_ROLES], async (request, user) => {
    try {
      const { searchParams } = new URL(request.url);
      const branchId = await resolveEodViewBranchId(user, searchParams.get('branchId'));
      if (!branchId) {
        return errorResponse(
          'No valid branch for this user. Your token may reference a branch that does not exist in this environment—log out and log in again, or contact support.',
          400
        );
      }

      const existingLock = await prisma.branchLock.findUnique({
        where: { branchId },
        select: {
          currentWorkingDate: true,
          timezone: true,
          lockTime: true,
          isManuallyExtended: true,
          manualOverrideUntil: true,
          manualOverrideByUserId: true,
        },
      });

      const existingTz = existingLock?.timezone ?? BRANCH_LOCK_TIMEZONE;
      const nowUtc = new Date();

      if (
        existingLock &&
        isWorkingDateAheadOfBranchCalendarToday(
          new Date(existingLock.currentWorkingDate),
          nowUtc,
          existingTz
        )
      ) {
        const branchCalendarTodayYmd = getBranchCalendarYmdForInstant(nowUtc, existingTz);
        const nextBusinessDayYmd = getBranchCalendarYmdForInstant(
          new Date(existingLock.currentWorkingDate),
          existingTz
        );
        return successResponse(
          {
            eodCompletedForBranchCalendarDay: true,
            branchCalendarTodayYmd,
            nextBusinessDayYmd,
            branchId,
            branchCalendarTimeZone: existingTz,
            processDate: parseDenominationEntryDateUtc(nextBusinessDayYmd).toISOString(),
            workingDateYmd: nextBusinessDayYmd,
            checklist: [],
            canCompleteEod: false,
            canProceedToDenominationStep: false,
            expectedCashCreditTotal: 0,
            catchUpApprovalRequired: false,
            catchUpApprovalGranted: false,
            eodCloseRequestStatus: 'NONE' as const,
            eodCloseRequestRejectionReason: null,
          },
          'EOD already completed for today'
        );
      }

      const lockGuard = await assertBranchNotLocked(branchId);
      if (lockGuard) {
        return lockGuard;
      }

      const today = branchCalendarTodayUtcAnchor(existingTz);
      const defaultWindow = computeDefaultWindowForWorkingDate(
        today,
        BRANCH_LOCK_TIMEZONE,
        BRANCH_DEFAULT_OPEN_MINUTES,
        BRANCH_DEFAULT_CLOSE_MINUTES
      );

      const policyColumnsAvailable = await hasBranchLockPolicyColumns();

      let branchLock: { currentWorkingDate: Date; timezone?: string | null };
      if (policyColumnsAvailable) {
        try {
          branchLock = await prisma.branchLock.upsert({
            where: { branchId },
            update: {},
            create: {
              branchId,
              currentWorkingDate: today,
              lockTime: defaultWindow.end,
              timezone: BRANCH_LOCK_TIMEZONE,
              defaultOpenMinutes: BRANCH_DEFAULT_OPEN_MINUTES,
              defaultCloseMinutes: BRANCH_DEFAULT_CLOSE_MINUTES,
              effectiveWindowStartAt: defaultWindow.start,
              effectiveWindowEndAt: defaultWindow.end,
            },
            select: { currentWorkingDate: true, timezone: true },
          });
        } catch {
          branchLock = await prisma.branchLock.upsert({
            where: { branchId },
            update: {},
            create: {
              branchId,
              currentWorkingDate: today,
              lockTime: defaultWindow.end,
            },
            select: { currentWorkingDate: true },
          });
        }
      } else {
        branchLock = await prisma.branchLock.upsert({
          where: { branchId },
          update: {},
          create: {
            branchId,
            currentWorkingDate: today,
            lockTime: defaultWindow.end,
          },
          select: { currentWorkingDate: true },
        });
      }

      const checklistResult = await computeEodChecklist(
        branchId,
        new Date(branchLock.currentWorkingDate),
        (branchLock as any).timezone ?? BRANCH_LOCK_TIMEZONE
      );

      const workingDateYmd = checklistResult.workingDateYmd;
      const branchCalendarTodayYmd = getBranchCalendarYmdForInstant(nowUtc, existingTz);
      const daysBehind = workingDateYmd && branchCalendarTodayYmd
        ? countPendingEodDaysBehind(workingDateYmd, branchCalendarTodayYmd, existingTz)
        : 0;
      // Catch-up EOD (past working dates) no longer requires Admin approval —
      // BRANCH_MANAGER and ADMIN both close it directly via POST below.
      const catchUpApprovalRequired = false;
      const catchUpApprovalGranted = true;

      const closeRequest = await prisma.eodCloseRequest.findUnique({
        where: { branchId_workingDateYmd: { branchId, workingDateYmd } },
        select: { status: true, rejectionReason: true },
      });

      return successResponse(
        {
          ...checklistResult,
          branchCalendarTodayYmd,
          daysBehind,
          catchUpApprovalRequired,
          catchUpApprovalGranted,
          eodCloseRequestStatus: closeRequest?.status ?? ('NONE' as const),
          eodCloseRequestRejectionReason: closeRequest?.rejectionReason ?? null,
        },
        'EOD checklist fetched successfully'
      );
    } catch (error) {
      console.error('EOD Process Error:', error);
      return errorResponse(
        error instanceof Error ? error.message : 'Internal Server Error',
        500
      );
    }
  })(req);
}

/**
 * POST /api/utilities/eod-process
 * Direct close — BRANCH_MANAGER and ADMIN both close EOD immediately here;
 * the branch's working date advances as soon as this call succeeds, with no
 * separate Area Manager approval step. (POST /api/eod-close-requests and its
 * approve/reject endpoints remain only to resolve any pre-existing requests
 * from before this change — no new ones are created.)
 */
export async function POST(req: NextRequest) {
  return withRole([...EOD_PROCESS_CLOSE_ROLES], async (request, user) => {
    try {
      const { searchParams } = new URL(request.url);
      const branchId = await resolveEodViewBranchId(user, searchParams.get('branchId'));
      if (!branchId) {
        return errorResponse(
          'No valid branch for this user. Log out and log in again if you changed environments.',
          400
        );
      }

      const lockGuard = await assertBranchNotLocked(branchId);
      if (lockGuard) {
        return lockGuard;
      }

      const { nextDate } = await closeEodForBranch(branchId, user);

      return successResponse({ nextDate }, 'EOD closed successfully');
    } catch (error) {
      if (error instanceof EodCloseError) {
        return errorResponse(error.message, error.status);
      }
      console.error('EOD Process Error:', error);
      return errorResponse(
        error instanceof Error ? error.message : 'Failed to process EOD',
        500
      );
    }
  })(req);
}
