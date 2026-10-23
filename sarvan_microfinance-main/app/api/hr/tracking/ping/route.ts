import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { getUtcBoundsForBranchCalendarDay } from '@/app/lib/branch-lock';
import { autoCompleteSecondHalfLeavePunchOut } from '@/app/lib/attendance-leave-permission';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const pingSchema = z.object({
    latitude: z.number(),
    longitude: z.number(),
    accuracyMeters: z.number().optional().nullable(),
    batteryPercent: z.number().min(0).max(100).optional().nullable(),
    activityType: z.enum(['PUNCH_IN', 'PUNCH_OUT', 'CLIENT_VISIT', 'EN_ROUTE', 'IDLE_PING']),
    clientId: z.string().optional().nullable(),
    capturedAt: z.coerce.date().optional(),
});

// POST /api/hr/tracking/ping — field app calls this on a background interval
// and at Punch In/Out/Client-Visit-mark events. Soft-capture, never blocking:
// callers should fire-and-forget this and not fail the underlying action
// (punch, visit) if this write fails.
//
// Discrete business events (PUNCH_IN/PUNCH_OUT/CLIENT_VISIT) are written to
// EmployeeTrackingEvent; continuous background movement (EN_ROUTE/IDLE_PING)
// stays on EmployeeLocationPing — see attendance-hr/architecture-live-tracking.md.
export async function POST(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const body = await req.json();
            const data = pingSchema.parse(body);

            const employee = await prisma.user.findUnique({ where: { id: user.userId }, select: { branchId: true } });

            if (data.activityType === 'PUNCH_IN' || data.activityType === 'PUNCH_OUT' || data.activityType === 'CLIENT_VISIT') {
                const event = await prisma.employeeTrackingEvent.create({
                    data: {
                        employeeId: user.userId,
                        latitude: data.latitude,
                        longitude: data.longitude,
                        accuracyMeters: data.accuracyMeters,
                        batteryPercent: data.batteryPercent,
                        eventType: data.activityType,
                        clientId: data.clientId,
                        branchId: employee?.branchId,
                        capturedAt: data.capturedAt ?? new Date(),
                    },
                });
                return successResponse({ id: event.id }, 'Tracking event recorded', 201);
            }

            const ping = await prisma.employeeLocationPing.create({
                data: {
                    employeeId: user.userId,
                    latitude: data.latitude,
                    longitude: data.longitude,
                    accuracyMeters: data.accuracyMeters,
                    batteryPercent: data.batteryPercent,
                    activityType: data.activityType,
                    branchId: employee?.branchId,
                    capturedAt: data.capturedAt ?? new Date(),
                },
            });

            // Auto punch-out at the session boundary for a Second-Half leave day —
            // see attendance-hr/plan-half-day-leave.md §6. No-ops instantly unless
            // this employee is genuinely still checked-in past their leave's
            // boundary today; never blocks the ping itself if it errors.
            const { dayStartUtc } = getUtcBoundsForBranchCalendarDay(ping.capturedAt, 'Asia/Kolkata');
            autoCompleteSecondHalfLeavePunchOut({
                employeeId: user.userId,
                dayStartUtc,
                lastKnownLocation: { latitude: data.latitude, longitude: data.longitude },
            }).catch((err) => console.error('[Tracking Ping] Auto punch-out check failed:', err));

            return successResponse({ id: ping.id }, 'Location ping recorded', 201);
        } catch (error: any) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            console.error('Error recording location ping:', error);
            return errorResponse(error.message || 'Failed to record location ping', 500);
        }
    })(request);
}
