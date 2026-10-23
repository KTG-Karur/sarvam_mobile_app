import { prisma } from '@/app/lib/db';
import type { RoutePoint } from '@/app/lib/route-similarity';

/**
 * One employee's GPS points for a day, merged from EmployeeLocationPing +
 * EmployeeTrackingEvent (CLIENT_VISIT/PUNCH_IN/PUNCH_OUT/etc. live in the events table, not
 * the pings table — see attendance-hr/architecture-live-tracking.md), sorted by time.
 *
 * Deliberately a standalone query, not a refactor of the existing travel-client-visit
 * fetcher's inline merge logic in app/api/hr/reports/[slug]/route.ts — that fetcher's
 * behavior is left exactly as it is; see attendance-hr/plan-travel-similarity-report.md's
 * "Untouched, explicitly" note.
 */
export async function getEmployeeDayRoutePoints(employeeId: string, dayStartUtc: Date, dayEndUtc: Date): Promise<RoutePoint[]> {
    const [pings, events] = await Promise.all([
        prisma.employeeLocationPing.findMany({
            where: { employeeId, capturedAt: { gte: dayStartUtc, lte: dayEndUtc } },
            select: { latitude: true, longitude: true, capturedAt: true },
        }),
        prisma.employeeTrackingEvent.findMany({
            where: { employeeId, capturedAt: { gte: dayStartUtc, lte: dayEndUtc } },
            select: { latitude: true, longitude: true, capturedAt: true },
        }),
    ]);
    return [...pings, ...events].sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
}
