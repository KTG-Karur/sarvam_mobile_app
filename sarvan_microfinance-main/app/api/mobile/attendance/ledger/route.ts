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
 * Format a Date object or ISO string to 12-hour IST time (e.g., "10:14 AM")
 */
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
 * GET /api/mobile/attendance/ledger
 * 
 * Dedicated mobile endpoint for employees to view their OWN Attendance Ledger.
 * - Extracts `userId` strictly from the caller's JWT Bearer token (no HR report overlap).
 * - Accepts optional `month` (1-12) and `year` (e.g. 2026) OR `fromDate` and `tillDate`.
 * - Defaults to current calendar month in Asia/Kolkata (IST).
 * - Returns employee profile, monthly totals summary, and line-by-line chronological attendance history.
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
            const sortOrder = (searchParams.get('order') || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

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
                include: {
                    leaveType: {
                        select: {
                            id: true,
                            leaveType: true,
                            isLop: true,
                        },
                    },
                },
                orderBy: { date: sortOrder },
            });

            // 3. Map Attendance Ledger Records
            const ledgerRecords = attendanceRows.map((row) => {
                const dateYmd = getKolkataCalendarYmd(row.date);
                const dObj = new Date(row.date);
                const dayOfWeek = dObj.toLocaleDateString('en-US', { timeZone: 'Asia/Kolkata', weekday: 'long' });

                const checkInFormatted = formatTime12h(row.checkIn);
                const checkOutFormatted = formatTime12h(row.checkOut);

                let displayStatus: 'PRESENT' | 'HALF_DAY' | 'ABSENT' | 'ON_LEAVE' | 'HOLIDAY' = 'ABSENT';

                if (row.isHoliday) {
                    displayStatus = 'HOLIDAY';
                } else if (row.leaveTypeId && row.status === 'ABSENT') {
                    displayStatus = 'ON_LEAVE';
                } else if (row.status === 'HALF_DAY') {
                    displayStatus = 'HALF_DAY';
                } else if (row.status === 'PRESENT') {
                    displayStatus = 'PRESENT';
                } else {
                    displayStatus = 'ABSENT';
                }

                return {
                    id: row.id,
                    date: dateYmd,
                    dayOfWeek,
                    status: row.status,
                    displayStatus,
                    checkIn: row.checkIn ? row.checkIn.toISOString() : null,
                    checkInTime: checkInFormatted,
                    checkOut: row.checkOut ? row.checkOut.toISOString() : null,
                    checkOutTime: checkOutFormatted,
                    workingHours: row.workingHours ? Number(Number(row.workingHours).toFixed(2)) : null,
                    isHalfDayLeave: row.isHalfDayLeave,
                    isHoliday: row.isHoliday,
                    leaveInfo: row.leaveType
                        ? {
                              id: row.leaveType.id,
                              name: row.leaveType.leaveType,
                              isLop: row.leaveType.isLop,
                          }
                        : null,
                };
            });

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
                        totalRecords: ledgerRecords.length,
                    },
                    records: ledgerRecords,
                },
                'Attendance ledger retrieved successfully'
            );
        } catch (error) {
            console.error('[Mobile Attendance Ledger] Error:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to retrieve attendance ledger',
                500
            );
        }
    })(request);
}
