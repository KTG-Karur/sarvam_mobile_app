import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import {
    getKolkataCalendarYmd,
    getUtcBoundsForBranchCalendarDay,
} from '@/app/lib/branch-lock';
import { checkDayAttendanceAllowed } from '@/app/lib/attendance-schedule';
import { getApprovedLeaveForDay } from '@/app/lib/attendance-leave-permission';
import { PUNCH_RADIUS_METERS, PUNCH_RADIUS_MAX_ALLOWED_METERS } from '@/app/lib/punch-radius';

export async function OPTIONS() {
    return handleCorsPreflight();
}

function formatTime12h(date: Date | string | null | undefined): string | null {
    if (!date) return null;
    const d = typeof date === 'string' ? new Date(date) : date;
    if (isNaN(d.getTime())) return null;
    return d.toLocaleTimeString('en-IN', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
    });
}

/**
 * GET /api/mobile/attendance/today
 * 
 * Dedicated mobile endpoint for an employee to view their OWN Today's Attendance.
 * - Extracts `userId` strictly from the caller's JWT Bearer token (no HR report overlap).
 * - Determines today in Asia/Kolkata timezone.
 * - Returns employee profile, shift/working-day status, punch timestamps, total working hours, and derived status.
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const now = new Date();
            const todayYmd = getKolkataCalendarYmd(now);
            const { dayStartUtc, dayEndUtc } = getUtcBoundsForBranchCalendarDay(now, 'Asia/Kolkata');
            const dayOfWeek = now.toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata', weekday: 'long' });

            // 1. Fetch Employee Profile
            const employee = await prisma.user.findUnique({
                where: { id: user.userId },
                select: {
                    id: true,
                    employeeId: true,
                    firstName: true,
                    lastName: true,
                    role: true,
                    designation: true,
                    punchRadiusLocked: true,
                    branch: { select: { id: true, name: true, code: true } },
                },
            });

            if (!employee) {
                return errorResponse('Employee profile not found', 404);
            }

            // 2. Concurrently fetch today's attendance record & approved leave
            const [attendance, approvedLeave] = await Promise.all([
                prisma.attendance.findFirst({
                    where: {
                        userId: user.userId,
                        date: { gte: dayStartUtc, lte: dayEndUtc },
                    },
                    include: {
                        leaveType: {
                            select: { id: true, leaveType: true, isLop: true },
                        },
                    },
                }),
                getApprovedLeaveForDay(user.userId, dayStartUtc, now),
            ]);

            const dayCheck = await checkDayAttendanceAllowed(now, employee.branch?.id || '');
            const punchedIn = Boolean(attendance?.checkIn);
            const punchedOut = Boolean(attendance?.checkOut);
            const isHoliday = Boolean(attendance?.isHoliday || attendance?.status === 'HOLIDAY');

            // 3. Determine status
            let status = attendance?.status ?? (punchedIn ? 'PRESENT' : 'NOT_MARKED');
            let displayStatus: 'PRESENT' | 'HALF_DAY' | 'ABSENT' | 'ON_LEAVE' | 'HOLIDAY' | 'NOT_MARKED' = 'NOT_MARKED';

            if (isHoliday) {
                displayStatus = 'HOLIDAY';
            } else if (approvedLeave || (attendance?.leaveTypeId && attendance?.status === 'ABSENT')) {
                displayStatus = 'ON_LEAVE';
            } else if (attendance?.status === 'HALF_DAY') {
                displayStatus = 'HALF_DAY';
            } else if (attendance?.status === 'PRESENT') {
                displayStatus = 'PRESENT';
            } else if (attendance?.status === 'ABSENT') {
                displayStatus = 'ABSENT';
            } else if (punchedIn) {
                displayStatus = 'PRESENT';
            } else {
                displayStatus = 'NOT_MARKED';
            }

            return successResponse(
                {
                    employee: {
                        id: employee.id,
                        employeeId: employee.employeeId,
                        name: `${employee.firstName} ${employee.lastName}`.trim(),
                        role: employee.role,
                        designation: employee.designation,
                        branch: employee.branch
                            ? `${employee.branch.code} - ${employee.branch.name}`
                            : 'Unassigned',
                    },
                    today: {
                        date: todayYmd,
                        dayOfWeek,
                        isWorkingDay: dayCheck.isWorkingDay && !isHoliday,
                        isWeeklyOff: !dayCheck.isWorkingDay,
                        isHoliday,
                    },
                    punchRadius: {
                        locked: employee.punchRadiusLocked,
                        radiusMeters: PUNCH_RADIUS_METERS,
                        maxAllowedMeters: PUNCH_RADIUS_MAX_ALLOWED_METERS,
                    },
                    punch: {
                        punchedIn,
                        punchedOut,
                        checkIn: attendance?.checkIn ? attendance.checkIn.toISOString() : null,
                        checkInTime: formatTime12h(attendance?.checkIn),
                        checkOut: attendance?.checkOut ? attendance.checkOut.toISOString() : null,
                        checkOutTime: formatTime12h(attendance?.checkOut),
                        workingHours: attendance?.workingHours
                            ? Number(Number(attendance.workingHours).toFixed(2))
                            : 0,
                        status: attendance?.status ?? null,
                        displayStatus,
                    },
                    leave: approvedLeave
                        ? {
                              onLeave: true,
                              leaveType: approvedLeave.leaveTypeName,
                              isHalfDay: approvedLeave.isHalfDay,
                              halfDaySession: approvedLeave.halfDaySession,
                          }
                        : attendance?.leaveType
                        ? {
                              onLeave: true,
                              leaveType: attendance.leaveType.leaveType,
                              isHalfDay: Boolean(attendance.isHalfDayLeave),
                              halfDaySession: null,
                          }
                        : {
                              onLeave: false,
                              leaveType: null,
                              isHalfDay: false,
                              halfDaySession: null,
                          },
                },
                "Today's attendance retrieved successfully"
            );
        } catch (error) {
            console.error('[Mobile Today Attendance] Error:', error);
            return errorResponse(
                error instanceof Error ? error.message : "Failed to retrieve today's attendance",
                500
            );
        }
    })(request);
}
