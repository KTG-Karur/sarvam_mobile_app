import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { errorResponse, successResponse, withRole, handleCorsPreflight } from '@/app/lib/api-utils';
import { resolveEodViewBranchId } from '@/app/lib/denomination-entry';
import { getBranchCalendarYmdForInstant } from '@/app/lib/branch-financial-day';
import { BRANCH_LOCK_TIMEZONE } from '@/app/lib/branch-lock';
import { normalizeDenominationCounts } from '@/app/lib/denomination-money';
import { computeAutoDenominationForBranch } from '@/app/lib/eod-denomination-auto';

const EOD_PROCESS_ROLES = ['BRANCH_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'] as const;

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/utilities/eod-process/collection-denomination-summary
 *
 * Aggregates every APPROVED center's CollectionMeetingRecord for the branch's
 * current EOD working date. Thin wrapper over computeAutoDenominationForBranch()
 * (app/lib/eod-denomination-auto.ts) — the same aggregation now also backs the
 * auto-computed, read-only denomination step on the embedded EOD flow.
 */
export async function GET(request: NextRequest) {
    return withRole([...EOD_PROCESS_ROLES], async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const branchId = await resolveEodViewBranchId(user, searchParams.get('branchId'));
            if (!branchId) {
                return errorResponse('No valid branch for this user.', 400);
            }

            const lock = await prisma.branchLock.findUnique({
                where: { branchId },
                select: { currentWorkingDate: true, timezone: true },
            });

            const emptyCounts = normalizeDenominationCounts({});
            if (!lock) {
                return successResponse(
                    { workingDateYmd: null, counts: emptyCounts, upi: 0, totalAmount: 0, centers: [] },
                    'No working date set for this branch yet'
                );
            }

            const tz = lock.timezone || BRANCH_LOCK_TIMEZONE;
            const workingDateYmd = getBranchCalendarYmdForInstant(new Date(lock.currentWorkingDate), tz);

            const summary = await computeAutoDenominationForBranch(branchId, workingDateYmd);

            return successResponse(
                summary,
                summary.centers.length > 0
                    ? 'Collection denomination summary fetched'
                    : 'No center collections recorded for this working date yet'
            );
        } catch (error) {
            console.error('[EOD Collection Denomination Summary] Error:', error);
            return errorResponse('Failed to fetch collection denomination summary', 500);
        }
    })(request);
}
