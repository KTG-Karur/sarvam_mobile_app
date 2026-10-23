import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { BRANCH_LOCK_TIMEZONE } from '@/app/lib/branch-lock';
import { parseDenominationEntryDateUtc } from '@/app/lib/branch-financial-day';
import { resolveEodViewBranchId } from '@/app/lib/denomination-entry';
import { computeEodChecklist } from '@/app/lib/eod-checklist';
import { buildEodChecklistDetails } from '@/app/lib/eod-checklist-details';

// View-only roles — same set allowed to view the live EOD status.
const EOD_HISTORY_VIEW_ROLES = ['BRANCH_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH', 'AREA_MANAGER'] as const;

/**
 * GET /api/utilities/eod-process/history?date=YYYY-MM-DD&branchId=xxx
 *
 * Read-only checklist snapshot for an arbitrary (usually already-closed) business date,
 * so the EOD Process page can show "what happened that day" without touching the live
 * BranchLock / write-window machinery that `/api/utilities/eod-process` owns. Both
 * `computeEodChecklist` and `buildEodChecklistDetails` are pure functions of
 * (branchId, date, timezone) already — this route just calls them directly for the
 * requested date instead of the branch's current pending working date.
 */
export async function GET(req: NextRequest) {
    return withRole([...EOD_HISTORY_VIEW_ROLES], async (request, user) => {
        try {
            const { searchParams } = new URL(request.url);
            const dateYmd = searchParams.get('date');
            if (!dateYmd || !/^\d{4}-\d{2}-\d{2}$/.test(dateYmd)) {
                return errorResponse('date is required (YYYY-MM-DD)', 400);
            }

            const branchId = await resolveEodViewBranchId(user, searchParams.get('branchId'));
            if (!branchId) {
                return errorResponse('No valid branch for this user.', 400);
            }

            const lock = await prisma.branchLock.findUnique({
                where: { branchId },
                select: { timezone: true },
            });
            const timezone = lock?.timezone ?? BRANCH_LOCK_TIMEZONE;
            const processDate = parseDenominationEntryDateUtc(dateYmd);

            const [checklistResult, detailsResult] = await Promise.all([
                computeEodChecklist(branchId, processDate, timezone),
                buildEodChecklistDetails(branchId, processDate, timezone),
            ]);

            return successResponse(
                {
                    branchId,
                    workingDateYmd: checklistResult.workingDateYmd,
                    branchCalendarTimeZone: timezone,
                    checklist: checklistResult.checklist,
                    sections: detailsResult.sections,
                },
                'Historical EOD details fetched'
            );
        } catch (error) {
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to load historical EOD details',
                500
            );
        }
    })(req);
}
