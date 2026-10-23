import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import {
    getKolkataCalendarYmd,
    getKolkataDayEndExclusiveUtc,
    parseKolkataAttendanceDateYmd,
} from '@/app/lib/branch-lock';
import { getBranchWorkingDayWindow } from '@/app/lib/branch-working-day-guard';
import { round2, netScheduleComponents, NON_OUTSTANDING_SCHEDULE_STATUSES } from '@/app/lib/collections/demand-calculation';
import { getPendingScheduleAmounts } from '@/app/lib/collections/pending-schedule-amounts';
import { buildFdoCenterScope } from '@/app/lib/filters/fdo-center-scope';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { getMeetingDayName, buildMeetingDayVariantOrFilter } from '@/app/lib/collections/meeting-day';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/collections/demand/centers
 * Centers eligible for demand collection today, scoped to ONLY the
 * demand-collection page: meeting day matches the branch's current EOD
 * working date AND the center still has outstanding demand (> 0) for it.
 *
 * The working date is resolved server-side (BranchLock.currentWorkingDate
 * via getBranchWorkingDayWindow) rather than trusted from the client, since
 * the shared /api/utilities/eod-process endpoint that the rest of the app
 * uses for this is role-gated to BRANCH_MANAGER/ADMIN and 403s for FDO —
 * this page is used by both roles, so it cannot depend on that endpoint.
 *
 * The remaining-demand computation shares `netScheduleComponents` (from
 * app/lib/collections/demand-calculation.ts) and the same
 * `getPendingScheduleAmounts` pending lookup with the loan-grouped
 * calculation in GET /api/collections/demand (route.ts), so the two
 * endpoints net still-PENDING collections (regardless of age) exactly once
 * and can't disagree with each other about what's still outstanding.
 *
 * Query params: branchId (optional; ADMIN/AREA_MANAGER, or an FDO assigned to it)
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const branchIdParam = searchParams.get('branchId');

            // ── Role-based center scope (mirrors GET /api/centers) ──
            const where: any = {
                isActive: true,
                status: 'APPROVED',
            };

            let resolvedBranchId: string | null = null;

            if (user.role === 'BRANCH_MANAGER') {
                const userRecord = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: { branchId: true },
                });
                if (!userRecord || !userRecord.branchId) {
                    return errorResponse('No branch found for this user', 400);
                }
                resolvedBranchId = userRecord.branchId;
                where.branchId = resolvedBranchId;
            } else if (user.role === 'FDO') {
                Object.assign(where, buildFdoCenterScope(user));
                // Multi-branch FDO (UserBranchAssignment): honor the page's selected
                // branch so its own EOD working date / meeting day is used — otherwise
                // every assigned branch was filtered by the primary branch's date.
                if (branchIdParam) {
                    const permitted = await getPermittedBranchIds(user);
                    if (permitted === null || permitted.includes(branchIdParam)) {
                        resolvedBranchId = branchIdParam;
                        where.branchId = branchIdParam;
                    }
                }
                resolvedBranchId = resolvedBranchId ?? user.branchId ?? null;
                if (!resolvedBranchId) {
                    const userRecord = await prisma.user.findUnique({
                        where: { id: user.userId },
                        select: { branchId: true },
                    });
                    resolvedBranchId = userRecord?.branchId ?? null;
                }
                if (!resolvedBranchId) {
                    return errorResponse('No branch found for this user', 400);
                }
            } else {
                resolvedBranchId = branchIdParam || user.branchId || null;
                if (resolvedBranchId) {
                    where.branchId = resolvedBranchId;
                } else {
                    return errorResponse('branchId is required', 400);
                }
            }

            // ── Resolve the branch's current EOD working date server-side ──
            let workingDateYmd: string;
            try {
                const window = await getBranchWorkingDayWindow({ branchId: resolvedBranchId });
                workingDateYmd = window.workingDateYmd;
            } catch {
                // No BranchLock row yet (e.g. brand-new branch, EOD never run) —
                // fall back to today in IST. Read-only; does not create any row.
                workingDateYmd = getKolkataCalendarYmd(new Date());
            }

            const dayStartUtc = parseKolkataAttendanceDateYmd(workingDateYmd);
            const dayEndExclusiveUtc = getKolkataDayEndExclusiveUtc(dayStartUtc);

            // ── Meeting day filter ──
            const meetingDayName = getMeetingDayName(workingDateYmd);
            Object.assign(where, buildMeetingDayVariantOrFilter(meetingDayName));

            const candidateCenters = await prisma.center.findMany({
                where,
                select: { id: true, name: true, code: true },
            });

            if (candidateCenters.length === 0) {
                return successResponse({ collectionDate: workingDateYmd, centers: [] }, 'No centers found');
            }

            const candidateCenterIds = candidateCenters.map((c) => c.id);

            // ── Demand aggregation (mirrors GET /api/collections/demand) ──
            const loans = await prisma.loan.findMany({
                where: {
                    centerId: { in: candidateCenterIds },
                    isActive: true,
                    disbursementStatus: 'DISBURSED',
                    NOT: { deathMarking: { some: { isReversed: false, demandRequired: false } } },
                },
                select: {
                    id: true,
                    centerId: true,
                    schedules: {
                        where: {
                            dueDate: {
                                lte: new Date(dayEndExclusiveUtc.getTime() - 1),
                            },
                            // See NON_OUTSTANDING_SCHEDULE_STATUSES — excludes only the
                            // truly final statuses, not PAID, since status can drift from
                            // the actual due-vs-paid amounts.
                            status: {
                                notIn: NON_OUTSTANDING_SCHEDULE_STATUSES,
                            },
                        },
                        select: {
                            id: true,
                            principalDue: true,
                            principalPaid: true,
                            interestDue: true,
                            interestPaid: true,
                            feesDue: true,
                            feesPaid: true,
                            penaltiesDue: true,
                            penaltiesPaid: true,
                        },
                    },
                },
            });

            const scheduleIds = loans.flatMap((l) => l.schedules.map((s) => s.id));

            // PENDING-only, component-level, regardless of which day they were
            // submitted: used to NET staged-but-not-yet-approved collections out of
            // remaining due (see route.ts GET for why APPROVED lines must be
            // excluded here — they're already reflected in schedule.*Paid).
            const pendingByScheduleId = await getPendingScheduleAmounts(scheduleIds);

            const remainingByCenterId = new Map<string, number>();

            for (const loan of loans) {
                if (loan.schedules.length === 0) continue;

                let loanTotalDemand = 0;

                for (const schedule of loan.schedules) {
                    const pending = pendingByScheduleId.get(schedule.id);
                    const net = netScheduleComponents({
                        principalDue: Number(schedule.principalDue),
                        principalPaid: Number(schedule.principalPaid || 0),
                        interestDue: Number(schedule.interestDue),
                        interestPaid: Number(schedule.interestPaid || 0),
                        feesDue: Number(schedule.feesDue || 0),
                        feesPaid: Number(schedule.feesPaid || 0),
                        penaltiesDue: Number(schedule.penaltiesDue || 0),
                        penaltiesPaid: Number(schedule.penaltiesPaid || 0),
                        pendingPrincipal: pending?.principal ?? 0,
                        pendingInterest: pending?.interest ?? 0,
                        pendingFees: pending?.fees ?? 0,
                        pendingPenalty: pending?.penalty ?? 0,
                    });

                    // Eligibility (per spec) is gated on Principal + Interest only.
                    if (net.netPrincipal <= 0 && net.netInterest <= 0) continue;

                    loanTotalDemand += net.netPrincipal + net.netInterest + net.netFees + net.netPenalties;
                }

                // loanTotalDemand is already net (single subtraction, per-component) —
                // no further subtraction needed.
                const loanRemaining = round2(Math.max(0, loanTotalDemand));
                if (loanRemaining <= 0) continue;

                const prev = remainingByCenterId.get(loan.centerId) ?? 0;
                remainingByCenterId.set(loan.centerId, prev + loanRemaining);
            }

            const eligibleCenters = candidateCenters.filter(
                (c) => (remainingByCenterId.get(c.id) ?? 0) > 0
            );

            return successResponse(
                { collectionDate: workingDateYmd, centers: eligibleCenters },
                `Found ${eligibleCenters.length} eligible centers`
            );
        } catch (error) {
            console.error('Error fetching demand-collection eligible centers:', error);
            return errorResponse('Failed to fetch eligible centers', 500);
        }
    })(request);
}
