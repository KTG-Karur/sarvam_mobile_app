import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';
import { getUtcBoundsForBranchCalendarDay } from '@/app/lib/branch-lock';
import { deriveEmployeeStatus, type TrackingPing } from '@/app/lib/hr-tracking';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// GET /api/hr/tracking/live — live dashboard data: current status per
// employee, filtered by Branch/Department/Designation/Employee/Status/
// Activity/Date. Branch-scoped like every other HR list route.
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const branchId = searchParams.get('branchId');
            const departmentId = searchParams.get('departmentId');
            const designationId = searchParams.get('designationId');
            const employeeId = searchParams.get('employeeId')?.trim();
            const search = searchParams.get('search')?.trim();
            const statusFilter = searchParams.get('status');
            const activityFilter = searchParams.get('activity');
            const dateParam = searchParams.get('date');

            // A requested branch can only narrow the caller's permitted set, never widen it
            // ('all' / absent = every permitted branch).
            const scopedBranchIds = await resolveScopedBranchIds(user, branchId);
            const employeeWhere: Prisma.UserWhereInput = { isActive: true };
            if (scopedBranchIds) employeeWhere.branchId = { in: scopedBranchIds };
            if (departmentId) employeeWhere.departmentId = departmentId;
            if (designationId) employeeWhere.designationId = designationId;
            if (employeeId) {
                employeeWhere.OR = [
                    { id: employeeId },
                    { employeeId: { equals: employeeId, mode: 'insensitive' } },
                ];
            } else if (search) {
                employeeWhere.OR = [
                    { employeeId: { contains: search, mode: 'insensitive' } },
                    { firstName: { contains: search, mode: 'insensitive' } },
                    { lastName: { contains: search, mode: 'insensitive' } },
                ];
            }

            const employees = await prisma.user.findMany({
                where: employeeWhere,
                select: {
                    id: true, employeeId: true, firstName: true, lastName: true,
                    branch: { select: { id: true, name: true } },
                    designation: { select: { name: true } },
                },
            });
            if (employees.length === 0) return successResponse([], 'No employees found');

            const day = dateParam ? new Date(dateParam) : new Date();
            const { dayStartUtc, dayEndUtc } = getUtcBoundsForBranchCalendarDay(day);

            const employeeIds = employees.map((e) => e.id);
            const [pings, events, attendances] = await Promise.all([
                prisma.employeeLocationPing.findMany({
                    where: { employeeId: { in: employeeIds }, capturedAt: { gte: dayStartUtc, lte: dayEndUtc } },
                    select: { employeeId: true, latitude: true, longitude: true, capturedAt: true, activityType: true, batteryPercent: true, accuracyMeters: true },
                }),
                // PUNCH_IN/PUNCH_OUT/CLIENT_VISIT now live in EmployeeTrackingEvent, not
                // EmployeeLocationPing — merge both so status/last-location still reflect
                // punches (see attendance-hr/architecture-live-tracking.md).
                prisma.employeeTrackingEvent.findMany({
                    where: { employeeId: { in: employeeIds }, capturedAt: { gte: dayStartUtc, lte: dayEndUtc } },
                    select: { employeeId: true, latitude: true, longitude: true, capturedAt: true, eventType: true, clientId: true, batteryPercent: true, accuracyMeters: true },
                }),
                prisma.attendance.findMany({
                    where: { userId: { in: employeeIds }, date: dayStartUtc },
                    select: { userId: true, checkIn: true, checkOut: true },
                }),
            ]);

            const attendanceByUser = new Map<string, { checkIn: Date | null; checkOut: Date | null }>();
            for (const att of attendances) {
                attendanceByUser.set(att.userId, { checkIn: att.checkIn, checkOut: att.checkOut });
            }

            const pingsByEmployee = new Map<string, TrackingPing[]>();
            for (const p of pings) {
                const arr = pingsByEmployee.get(p.employeeId) ?? [];
                arr.push({ ...p, clientId: null });
                pingsByEmployee.set(p.employeeId, arr);
            }
            for (const e of events) {
                const arr = pingsByEmployee.get(e.employeeId) ?? [];
                arr.push({ ...e, activityType: e.eventType });
                pingsByEmployee.set(e.employeeId, arr);
            }
            for (const arr of pingsByEmployee.values()) {
                arr.sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
            }

            let result = employees.map((e) => {
                const employeePings = pingsByEmployee.get(e.id) ?? [];
                const last = employeePings[employeePings.length - 1];
                const status = deriveEmployeeStatus(employeePings);
                // The chronologically-last point isn't always the one carrying a
                // battery reading — Collection/Center-Creation/Member-Enrollment
                // writes don't send batteryPercent, so scan backward for the most
                // recent point that actually has one.
                const lastBattery = [...employeePings].reverse().find((p) => p.batteryPercent != null)?.batteryPercent ?? null;
                const att = attendanceByUser.get(e.id);
                const punchIn = att?.checkIn ?? employeePings.find((p) => p.activityType === 'PUNCH_IN')?.capturedAt ?? null;
                const punchOut = att?.checkOut ?? [...employeePings].reverse().find((p) => p.activityType === 'PUNCH_OUT')?.capturedAt ?? null;

                return {
                    id: e.id,
                    employeeId: e.employeeId,
                    name: `${e.firstName} ${e.lastName}`,
                    branch: e.branch?.name ?? null,
                    designation: e.designation?.name ?? null,
                    status,
                    lastActivity: last?.activityType ?? null,
                    lastUpdated: last?.capturedAt ?? null,
                    lastLocation: last ? { latitude: last.latitude, longitude: last.longitude } : null,
                    lastBatteryPercent: lastBattery,
                    punchIn,
                    punchOut,
                };
            });

            if (statusFilter) result = result.filter((r) => r.status === statusFilter);
            if (activityFilter) result = result.filter((r) => r.lastActivity === activityFilter);

            return successResponse(result, 'Live tracking data fetched successfully');
        } catch (error: any) {
            console.error('Error fetching live tracking data:', error);
            return errorResponse(error.message || 'Failed to fetch live tracking data', 500);
        }
    })(request);
}
