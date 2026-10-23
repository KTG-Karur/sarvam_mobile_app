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
} from '@/app/lib/branch-financial-day';
import { hasBranchLockPolicyColumns } from '@/app/lib/branch-lock-policy-schema';
import { buildEodChecklistDetails } from '@/app/lib/eod-checklist-details';
import { resolveEodViewBranchId } from '@/app/lib/denomination-entry';

const EOD_CHECKLIST_DETAILS_ROLES = ['BRANCH_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH', 'AREA_MANAGER'] as const;

export async function GET(req: NextRequest) {
    return withRole([...EOD_CHECKLIST_DETAILS_ROLES], async (request, user) => {
        try {
            const { searchParams } = new URL(request.url);
            const branchId = await resolveEodViewBranchId(user, searchParams.get('branchId'));
            if (!branchId) {
                return errorResponse(
                    'No valid branch for this user. Log out and log in again if you changed environments.',
                    400
                );
            }

            const existingLock = await prisma.branchLock.findUnique({
                where: { branchId },
                select: { currentWorkingDate: true, timezone: true },
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
                return successResponse(
                    {
                        eodCompletedForBranchCalendarDay: true,
                        branchCalendarTodayYmd,
                        workingDateYmd: getBranchCalendarYmdForInstant(
                            new Date(existingLock.currentWorkingDate),
                            existingTz
                        ),
                        branchCalendarTimeZone: existingTz,
                        sections: [],
                    },
                    'EOD already completed — no live checklist details'
                );
            }

            const lockGuard = await assertBranchNotLocked(branchId);
            if (lockGuard) {
                return lockGuard;
            }

            const policyColumnsAvailable = await hasBranchLockPolicyColumns();
            const today = branchCalendarTodayUtcAnchor(existingTz);
            const defaultWindow = computeDefaultWindowForWorkingDate(
                today,
                BRANCH_LOCK_TIMEZONE,
                BRANCH_DEFAULT_OPEN_MINUTES,
                BRANCH_DEFAULT_CLOSE_MINUTES
            );

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

            const timezone =
                policyColumnsAvailable &&
                'timezone' in branchLock &&
                typeof branchLock.timezone === 'string' &&
                branchLock.timezone.length > 0
                    ? branchLock.timezone
                    : BRANCH_LOCK_TIMEZONE;

            const payload = await buildEodChecklistDetails(
                branchId,
                new Date(branchLock.currentWorkingDate),
                timezone
            );

            return successResponse(
                {
                    eodCompletedForBranchCalendarDay: false,
                    ...payload,
                },
                'EOD checklist details fetched successfully'
            );
        } catch (error) {
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to load EOD checklist details',
                500
            );
        }
    })(req);
}
