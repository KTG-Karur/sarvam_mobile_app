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

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/mobile/attendance/summary
 * 
 * Dedicated mobile endpoint for an employee to view their OWN Attendance Summary.
 * - Extracts `userId` strictly from the caller's JWT Bearer token (no HR report overlap).
 * - Accepts optional `month` (1-12) and `year` (e.g. 2026) OR `fromDate` and `tillDate`.
 * - Defaults to current calendar month in Asia/Kolkata (IST).
 * - Returns employee profile and aggregated monthly metrics (present, half-day, absent, leave, holiday, work hours).
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const now = new Date();
            const todayYmd = getKolkataCalendarYmd(now);
            const [curYearStr, curMonthStr] = todayYmd.split('-');

            const monthParam = searchParams.get('month');
            const yearParam = searchParams.get('year');
            const fromDateParam = searchParams.get('fromDate');
            const tillDateParam = searchParams.get('tillDate');

            let fromDateUtc: Date;
            let tillDateUtc: Date;
            let displayFromDate: string;
            let displayTillDate: string;

            if (fromDateParam && tillDateParam) {
                // Custom date range mode
                const fromLocal = new Date(`${fromDateParam.split('T')[0]}T00:00:00.000Z`);
                const tillLocal = new Date(`${tillDateParam.split('T')[0]}T23:59:59.999Z`);
                const { dayStartUtc: fUtc } = getUtcBoundsForBranchCalendarDay(fromLocal, 'Asia/Kolkata');
                const { dayEndUtc: tUtc } = getUtcBoundsForBranchCalendarDay(tillLocal, 'Asia/Kolkata');
                fromDateUtc = fUtc;
                tillDateUtc = tUtc;
                displayFromDate = fromDateParam.split('T')[0];
                displayTillDate = tillDateParam.split('T')[0];
            } else {
                // Month & Year mode (default to current month)
                const month = monthParam ? parseInt(monthParam, 10) : parseInt(curMonthStr, 10);
                const year = yearParam ? parseInt(yearParam, 10) : parseInt(curYearStr, 10);

                if (isNaN(month) || month < 1 || month > 12) {
                    return errorResponse('Month must be between 1 and 12', 400);
                }
                if (isNaN(year) || year < 2000 || year > 2100) {
                    return errorResponse('Invalid year', 400);
                }

                // Month bounds in IST
                const monthStartLocal = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
                // day 0 of next month is last day of current month
                const monthEndLocal = new Date(Date.UTC(year, month, 0, 12, 0, 0));

                const { dayStartUtc: mStartUtc } = getUtcBoundsForBranchCalendarDay(monthStartLocal, 'Asia/Kolkata');
                const { dayEndUtc: mEndUtc } = getUtcBoundsForBranchCalendarDay(monthEndLocal, 'Asia/Kolkata');

                fromDateUtc = mStartUtc;
                tillDateUtc = mEndUtc;
                displayFromDate = getKolkataCalendarYmd(monthStartLocal);
                displayTillDate = getKolkataCalendarYmd(monthEndLocal);
            }

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
                    branch: { select: { id: true, name: true, code: true } },
                },
            });

            if (!employee) {
                return errorResponse('Employee profile not found', 404);
            }

            // 2. Fetch Attendance Records strictly for user.userId
            const attendanceRows = await prisma.attendance.findMany({
                where: {
                    userId: user.userId,
                    date: { gte: fromDateUtc, lte: tillDateUtc },
                },
                select: {
                    id: true,
                    status: true,
                    workingHours: true,
                    isHalfDayLeave: true,
                    isHoliday: true,
                    leaveTypeId: true,
                },
            });

            // 3. Compute Summary Metrics
            let presentDays = 0;
            let halfDays = 0;
            let absentDays = 0;
            let leaveDays = 0;
            let holidays = 0;
            let totalWorkHours = 0;

            for (const row of attendanceRows) {
                if (row.isHoliday) {
                    holidays++;
                } else if (row.leaveTypeId && row.status === 'ABSENT') {
                    leaveDays += 1.0;
                } else if (row.status === 'HALF_DAY') {
                    halfDays++;
                    if (row.isHalfDayLeave) {
                        leaveDays += 0.5;
                    }
                } else if (row.status === 'PRESENT') {
                    presentDays++;
                } else {
                    absentDays++;
                }

                if (row.workingHours) {
                    totalWorkHours += Number(row.workingHours);
                }
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
                    period: {
                        fromDate: displayFromDate,
                        tillDate: displayTillDate,
                    },
                    summary: {
                        totalLoggedDays: attendanceRows.length,
                        presentDays,
                        halfDays,
                        absentDays,
                        leaveDays,
                        holidays,
                        totalWorkHours: Number(totalWorkHours.toFixed(2)),
                    },
                },
                'Attendance summary retrieved successfully'
            );
        } catch (error) {
            console.error('[Mobile Attendance Summary] Error:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to retrieve attendance summary',
                500
            );
        }
    })(request);
}
