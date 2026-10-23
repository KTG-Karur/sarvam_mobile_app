import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { getUtcBoundsForBranchCalendarDay } from '@/app/lib/branch-lock';
import { computeTravelledKm, countDistinctClientVisits, deriveEmployeeStatus, type TrackingPing } from '@/app/lib/hr-tracking';
import { buildMovementTimeline, denoiseRoute } from '@/app/lib/location-movement';

function formatDurationMinutes(ms: number): string {
    const totalMinutes = Math.max(1, Math.round(ms / 60000)); // floor at 1m so a single idle ping still reads as "Idle for 1m", not "0m"
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return `${minutes}m`;
    return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

export async function OPTIONS() {
    return handleCorsPreflight();
}

// GET /api/hr/tracking/employee/[id]/detail?date= — today's punch in/out,
// current status, clients visited, travelled KM, last/current location,
// route history, activity timeline.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    return withAuth(async (req, user) => {
        try {
            const { id } = await params;
            const employee = await prisma.user.findUnique({
                where: { id },
                select: {
                    id: true, employeeId: true, firstName: true, lastName: true, branchId: true,
                    branch: { select: { name: true } }, designation: { select: { name: true } },
                },
            });
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

            const [attendance, pings, events] = await Promise.all([
                prisma.attendance.findUnique({ where: { userId_date: { userId: id, date: dayStartUtc } } }),
                // Continuous background breadcrumbs only (EN_ROUTE/IDLE_PING).
                prisma.employeeLocationPing.findMany({
                    where: { employeeId: id, capturedAt: { gte: dayStartUtc, lte: dayEndUtc } },
                    orderBy: { capturedAt: 'asc' },
                }),
                // Every discrete milestone pin — PUNCH_IN/PUNCH_OUT/CLIENT_VISIT
                // (written by our own HR routes) and COLLECTION/CENTER_CREATED/
                // MEMBER_ENROLLED (written by Collections/Centers/Enrollment right
                // after their own record is saved — see
                // attendance-hr/architecture-live-tracking.md). One table, one
                // query, no more live reads of CollectionMeetingRecord/Center/Client.
                prisma.employeeTrackingEvent.findMany({
                    where: { employeeId: id, capturedAt: { gte: dayStartUtc, lte: dayEndUtc } },
                    orderBy: { capturedAt: 'asc' },
                }),
            ]);

            // countDistinctClientVisits only cares about manual CLIENT_VISIT taps.
            const trackingPings: TrackingPing[] = events
                .filter((e) => e.eventType === 'CLIENT_VISIT')
                .map((e) => ({
                    latitude: e.latitude, longitude: e.longitude, capturedAt: e.capturedAt, activityType: e.eventType, clientId: e.clientId,
                }));

            // Route points carry a `source` + `batteryPercent` on top of the shared
            // TrackingPing shape — local to this response, not part of hr-tracking.ts's type.
            // `accuracyMeters` lets the map drop low-quality GPS fixes that would
            // otherwise draw the route down streets the employee never walked.
            type RoutePoint = TrackingPing & {
                source: 'PING' | 'EVENT';
                batteryPercent: number | null;
                accuracyMeters: number | null;
            };
            const pingPoints: RoutePoint[] = pings.map((p) => ({
                latitude: p.latitude, longitude: p.longitude, capturedAt: p.capturedAt,
                activityType: p.activityType, clientId: null,
                source: 'PING', batteryPercent: p.batteryPercent, accuracyMeters: p.accuracyMeters,
            }));
            const eventPoints: RoutePoint[] = events.map((e) => ({
                latitude: e.latitude, longitude: e.longitude, capturedAt: e.capturedAt,
                activityType: e.eventType, clientId: e.clientId,
                source: 'EVENT', batteryPercent: e.batteryPercent, accuracyMeters: e.accuracyMeters,
            }));

            const mergedPoints: RoutePoint[] = [...pingPoints, ...eventPoints].sort(
                (a, b) => a.capturedAt.getTime() - b.capturedAt.getTime(),
            );

            return successResponse({
                employee: {
                    id: employee.id, employeeId: employee.employeeId, name: `${employee.firstName} ${employee.lastName}`,
                    branch: employee.branch?.name ?? null, designation: employee.designation?.name ?? null,
                },
                punchIn: attendance?.checkIn ?? null,
                punchOut: attendance?.checkOut ?? null,
                currentStatus: deriveEmployeeStatus(mergedPoints),
                clientVisitsManual: countDistinctClientVisits(trackingPings),
                centersVisitedViaCollection: new Set(
                    events.filter((e) => e.eventType === 'COLLECTION' && e.centerId).map((e) => e.centerId),
                ).size,
                centersCreatedCount: events.filter((e) => e.eventType === 'CENTER_CREATED').length,
                membersEnrolledCount: events.filter((e) => e.eventType === 'MEMBER_ENROLLED').length,
                travelledKm: computeTravelledKm(mergedPoints),
                lastLocation: mergedPoints.length > 0
                    ? { latitude: mergedPoints[mergedPoints.length - 1].latitude, longitude: mergedPoints[mergedPoints.length - 1].longitude }
                    : null,
                // The chronologically-last point isn't always the one carrying a
                // battery reading — Collection/Center-Creation/Member-Enrollment
                // writes (and any punch without a device battery reported) don't
                // send batteryPercent, so scan backward for the most recent point
                // that actually has one, rather than the literal last point.
                lastBatteryPercent: [...mergedPoints].reverse().find((p) => p.batteryPercent != null)?.batteryPercent ?? null,
                // The full punch-in → ... → punch-out path: every background ping
                // plus every discrete event, in chronological order.
                // Wobble from a stationary phone is dropped (events always stay); the raw fixes are still stored.
                routeHistory: denoiseRoute(mergedPoints.map((p) => ({ ...p, isEvent: p.source === 'EVENT' }))).map(({ isEvent, ...p }) => { void isEvent; return p; }),
                activityTimeline: buildMovementTimeline(
                    [
                        ...pings.map((p) => ({ capturedAt: p.capturedAt, latitude: p.latitude, longitude: p.longitude, accuracyMeters: p.accuracyMeters, isEvent: false, label: p.activityType.replace(/_/g, ' ') })),
                        ...events.map((e) => ({ capturedAt: e.capturedAt, latitude: e.latitude, longitude: e.longitude, accuracyMeters: e.accuracyMeters, isEvent: true, label: e.label ?? e.eventType.replace(/_/g, ' ') })),
                    ],
                    formatDurationMinutes,
                ),
            }, 'Employee tracking detail fetched successfully');
        } catch (error: any) {
            console.error('Error fetching employee tracking detail:', error);
            return errorResponse(error.message || 'Failed to fetch employee tracking detail', 500);
        }
    })(request);
}
