import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { getUtcBoundsForBranchCalendarDay } from '@/app/lib/branch-lock';
import { snapPointsToRoads, type SnappedPoint } from '@/app/lib/map-matching';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// GET /api/hr/tracking/employee/[id]/route-snapped?date= — the road-snapped
// version of that day's route (Google Roads API), cached in
// EmployeeRouteSnapshot so a finished day is only ever matched once (see
// attendance-hr/plan-road-snapped-tracking-map.md §4a). Falls back to `null`
// (never errors the page) if the provider isn't configured or the call
// fails — the map already draws the raw straight-line path as a baseline.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    return withAuth(async (req, user) => {
        try {
            const { id } = await params;
            const employee = await prisma.user.findUnique({ where: { id }, select: { id: true, branchId: true } });
            if (!employee) return errorResponse('Employee not found', 404);

            const permittedBranchIds = await getPermittedBranchIds(user);
            // Viewing your own tracking is always allowed — a BM/AM whose own
            // branch isn't in their assigned-branch list must still see their journey.
            const isSelf = employee.id === user.userId;
            if (!isSelf && permittedBranchIds && (!employee.branchId || !permittedBranchIds.includes(employee.branchId))) {
                return errorResponse('You do not have access to this employee', 403);
            }

            const { searchParams } = new URL(req.url);
            const dateParam = searchParams.get('date');
            const day = dateParam ? new Date(dateParam) : new Date();
            const { dayStartUtc, dayEndUtc } = getUtcBoundsForBranchCalendarDay(day);

            const [pings, events] = await Promise.all([
                prisma.employeeLocationPing.findMany({
                    where: { employeeId: id, capturedAt: { gte: dayStartUtc, lte: dayEndUtc } },
                    orderBy: { capturedAt: 'asc' },
                    select: { latitude: true, longitude: true, capturedAt: true },
                }),
                prisma.employeeTrackingEvent.findMany({
                    where: { employeeId: id, capturedAt: { gte: dayStartUtc, lte: dayEndUtc } },
                    orderBy: { capturedAt: 'asc' },
                    select: { latitude: true, longitude: true, capturedAt: true },
                }),
            ]);

            const rawPoints = [...pings, ...events]
                .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime())
                .map((p) => ({ latitude: p.latitude, longitude: p.longitude }));

            if (rawPoints.length < 2) {
                return successResponse({ snappedPath: null, pointCount: rawPoints.length }, 'Not enough points to snap');
            }

            const existing = await prisma.employeeRouteSnapshot.findUnique({
                where: { employeeId_date: { employeeId: id, date: dayStartUtc } },
            });

            if (existing && existing.pointCount === rawPoints.length) {
                return successResponse(
                    { snappedPath: existing.snappedPath as SnappedPoint[], pointCount: existing.pointCount, cached: true },
                    'Snapped route fetched from cache',
                );
            }

            let snappedPath: SnappedPoint[];
            try {
                snappedPath = await snapPointsToRoads(rawPoints);
            } catch (matchError: any) {
                console.error('[Route Snapped] Map-matching provider failed:', matchError);
                // Soft-fail: the caller falls back to the raw straight-line path.
                return successResponse({ snappedPath: null, pointCount: rawPoints.length, error: matchError.message }, 'Map matching unavailable');
            }

            await prisma.employeeRouteSnapshot.upsert({
                where: { employeeId_date: { employeeId: id, date: dayStartUtc } },
                update: { pointCount: rawPoints.length, snappedPath: snappedPath as any, provider: 'google', computedAt: new Date() },
                create: { employeeId: id, date: dayStartUtc, pointCount: rawPoints.length, snappedPath: snappedPath as any, provider: 'google' },
            });

            return successResponse({ snappedPath, pointCount: rawPoints.length, cached: false }, 'Snapped route computed');
        } catch (error: any) {
            console.error('Error fetching snapped route:', error);
            return errorResponse(error.message || 'Failed to fetch snapped route', 500);
        }
    })(request);
}
