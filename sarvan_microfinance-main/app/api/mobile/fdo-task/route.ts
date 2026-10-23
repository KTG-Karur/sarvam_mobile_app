import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { getKolkataCalendarYmd } from '@/app/lib/branch-lock';
import { computeTaskReport } from '@/app/api/reports/employee/task-report/route';

import { cachedMasterData, stableParamsKey } from '@/app/lib/cache/master-data-cache';

// computeTaskReport runs ~9 queries per FDO, including an unbounded
// loanSchedule.findMany (every due-date row for every disbursed+active loan
// in the FDO's centers, no date filter) — expensive, and this screen gets
// opened/reopened/refreshed repeatedly through the day. The figures derive
// from enrollment/disbursement/collection/gold-loan writes scattered across
// the whole app (far too many sites to chase individually, same call made
// for employees/client-tracker) — a short TTL is the pragmatic safety net.
// Scoped strictly to the caller's own userId, so no cross-FDO data exposure.
const FDO_TASK_CACHE_TTL_SECONDS = 3 * 60;

export async function OPTIONS() {
    return handleCorsPreflight();
}

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

const querySchema = z.object({
    month: z.coerce.number().int().min(1, 'Month must be between 1 and 12').max(12, 'Month must be between 1 and 12').optional(),
    year: z.coerce.number().int().min(2020, 'Invalid year').max(2100, 'Invalid year').optional(),
});

/** Achieved as a % of target, 2 dp; null when no target is set (avoids divide-by-zero / fake 0%). */
const progressPct = (achieved: number, target: number): number | null =>
    target > 0 ? Math.round((achieved / target) * 10000) / 100 : null;

/**
 * GET /api/mobile/fdo-task?month=9&year=2026
 *
 * Mobile endpoint for an FDO to view their OWN monthly task — the targets the
 * admin set in FDO Task Management (Enr. Target / New Member / Renewal /
 * Disbursement Target) against what they have achieved that month.
 * - `userId` comes strictly from the caller's JWT Bearer token; there is no
 *   way to request another FDO's data.
 * - `month` / `year` are optional and default to the current month (IST).
 * - Figures come from the same computation as the admin "FDO Task Report"
 *   (computeTaskReport), so the app and the report always agree.
 */
export async function GET(request: NextRequest) {
    return withRole(['FDO'], async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const parsed = querySchema.safeParse({
                month: searchParams.get('month') ?? undefined,
                year: searchParams.get('year') ?? undefined,
            });
            if (!parsed.success) return errorResponse(parsed.error.errors[0].message, 400);

            const [curYear, curMonth] = getKolkataCalendarYmd(new Date()).split('-').map(Number);
            const month = parsed.data.month ?? curMonth;
            const year = parsed.data.year ?? curYear;

            const report = await cachedMasterData(
                'fdoTaskReport',
                stableParamsKey({ userId: user.userId, month, year }),
                () => computeTaskReport(month, year, null, user.userId),
                FDO_TASK_CACHE_TTL_SECONDS
            );
            const row = report.fdo[0];
            if (!row) return errorResponse('FDO task data not found for this user', 404);

            return successResponse({
                employee: { employeeId: row.employeeId, name: row.name, branch: row.branch },
                period: { month, year, monthName: `${MONTH_NAMES[month - 1]} ${year}` },
                targets: {
                    enrollment: row.enrollmentTarget,
                    newMember: row.newMemberTarget,
                    renewal: row.renewalTarget,
                    loanDisbursement: row.loanDisbursementTarget,
                },
                achievement: {
                    enrollment: row.enrollmentAchieved,
                    newMember: row.newMemberAchieved,
                    renewal: row.renewalAchieved,
                    loanDisbursement: row.loanDisbursementAchieved,
                },
                progress: {
                    enrollmentPct: progressPct(row.enrollmentAchieved, row.enrollmentTarget),
                    newMemberPct: progressPct(row.newMemberAchieved, row.newMemberTarget),
                    renewalPct: progressPct(row.renewalAchieved, row.renewalTarget),
                    loanDisbursementPct: progressPct(row.loanDisbursementAchieved, row.loanDisbursementTarget),
                },
                enrollmentBalance: row.enrollmentBalance,
                collection: {
                    targetPct: row.collectionTargetPct,
                    actualPct: row.actualCollectionPct,
                    differencePct: row.collectionDifferencePct,
                },
                operations: {
                    numberOfCenters: row.numberOfCenters,
                    activeClients: row.activeClients,
                    activeMembers: row.activeMembers,
                    activeClientsWithLoan: row.activeClientsWithLoan,
                    totalDisbursementMembers: row.totalDisbursementMembers,
                },
                goldLoan: {
                    members: row.goldLoanMembers,
                    amount: row.goldLoanAmount,
                    goldReturn: row.goldReturn,
                },
                portfolio: {
                    principalOutstanding: row.portfolioPrincipal,
                    interestOutstanding: row.portfolioInterest,
                },
                arrear: {
                    clients: row.arrearClients,
                    principal: row.arrearPrincipal,
                    interest: row.arrearInterest,
                    memberPct: row.arrearMemberPct,
                },
            }, 'FDO task retrieved');
        } catch (error) {
            console.error('[Mobile FDO Task] Error:', error);
            return errorResponse('Failed to fetch FDO task', 500);
        }
    })(request);
}
