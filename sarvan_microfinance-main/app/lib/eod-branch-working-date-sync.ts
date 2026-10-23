import { prisma } from '@/app/lib/prisma';
import {
    getBranchCalendarYmdForInstant,
} from '@/app/lib/branch-financial-day';
import {
    BRANCH_DEFAULT_CLOSE_MINUTES,
    BRANCH_DEFAULT_OPEN_MINUTES,
    BRANCH_LOCK_TIMEZONE,
    computeDefaultWindowForWorkingDate,
} from '@/app/lib/branch-lock';
type BranchLockWorkingRow = {
    currentWorkingDate: Date;
    timezone?: string | null;
};

/**
 * Ensures branch-lock policy columns (effective window fields) are consistent for the
 * *existing* `currentWorkingDate`.
 *
 * IMPORTANT: This function must NEVER advance `currentWorkingDate` to the branch-calendar
 * "today" automatically. Microfinance operations require strict EOD continuity: if a
 * previous working day is pending, the system must surface that date and enforce
 * sequential EOD closure without skipping.
 */
export async function syncBranchWorkingDateToCalendarTodayIfBehind(
    branchId: string,
    branchLockRow: BranchLockWorkingRow,
    policyColumnsAvailable: boolean
): Promise<{ currentWorkingDate: Date; timezone: string }> {
    const tz =
        typeof branchLockRow.timezone === 'string' && branchLockRow.timezone.trim().length > 0
            ? branchLockRow.timezone
            : BRANCH_LOCK_TIMEZONE;

    const currentWorkingDate = new Date(branchLockRow.currentWorkingDate);
    const dayWindow = computeDefaultWindowForWorkingDate(
        currentWorkingDate,
        tz,
        BRANCH_DEFAULT_OPEN_MINUTES,
        BRANCH_DEFAULT_CLOSE_MINUTES
    );

    if (policyColumnsAvailable) {
        await prisma.branchLock.update({
            where: { branchId },
            data: {
                effectiveWindowStartAt: dayWindow.start,
                effectiveWindowEndAt: dayWindow.end,
                // lockTime is the source-of-truth for writable window in legacy logic; do not
                // shorten an existing manual override by overwriting it here.
            },
        });
    }

    // Legacy schemas do not have policy columns; nothing to sync without mutating working date.
    return { currentWorkingDate, timezone: tz };
}
