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
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';
import { getWeekConfiguration } from '@/app/lib/attendance-schedule';

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

const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
];

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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
            const tillDateParam = searchParams.get('tillDate') || searchParams.get('toDate');
            const reqBranchId = searchParams.get('branchId') || req.headers.get('x-branch-id');

            let isCustomRange = false;
            let rangeStartDateLocal: Date;
            let rangeEndDateLocal: Date;
            let periodMonth: number | null = null;
            let periodYear: number | null = null;
            let periodMonthName: string = '';
            let totalDays = 0;
            let resolvedFromDate: string = '';
            let resolvedTillDate: string = '';

            if (fromDateParam && tillDateParam) {
                const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
                if (!dateRegex.test(fromDateParam) || !dateRegex.test(tillDateParam)) {
                    return errorResponse('Invalid date format. Expected YYYY-MM-DD for fromDate and tillDate', 400);
                }
                if (fromDateParam > tillDateParam) {
                    return errorResponse('fromDate must be on or before tillDate', 400);
                }

                const [fy, fm, fd] = fromDateParam.split('-').map(Number);
                const [ty, tm, td] = tillDateParam.split('-').map(Number);
                rangeStartDateLocal = new Date(Date.UTC(fy, fm - 1, fd, 12, 0, 0));
                rangeEndDateLocal = new Date(Date.UTC(ty, tm - 1, td, 12, 0, 0));

                totalDays = Math.round((rangeEndDateLocal.getTime() - rangeStartDateLocal.getTime()) / (1000 * 60 * 60 * 24)) + 1;
                if (totalDays > 62) {
                    return errorResponse('Date range cannot exceed 62 days for matrix view', 400);
                }

                isCustomRange = true;
                resolvedFromDate = fromDateParam;
                resolvedTillDate = tillDateParam;
                periodMonthName = `${fromDateParam} to ${tillDateParam}`;
            } else {
                const month = monthParam ? parseInt(monthParam, 10) : parseInt(curMonthStr, 10);
                const year = yearParam ? parseInt(yearParam, 10) : parseInt(curYearStr, 10);

                if (isNaN(month) || month < 1 || month > 12) {
                    return errorResponse('Month must be between 1 and 12', 400);
                }
                if (isNaN(year) || year < 2000 || year > 2100) {
                    return errorResponse('Invalid year', 400);
                }

                const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
                rangeStartDateLocal = new Date(Date.UTC(year, month - 1, 1, 12, 0, 0));
                rangeEndDateLocal = new Date(Date.UTC(year, month - 1, daysInMonth, 12, 0, 0));
                totalDays = daysInMonth;

                periodMonth = month;
                periodYear = year;
                periodMonthName = `${MONTH_NAMES[month - 1]} ${year}`;
                resolvedFromDate = `${year}-${String(month).padStart(2, '0')}-01`;
                resolvedTillDate = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
            }

            // 1. Resolve Branch
            const scopedBranchIds = await resolveScopedBranchIds(user, reqBranchId);
            let targetBranchId: string | null = null;

            if (scopedBranchIds && scopedBranchIds.length > 0) {
                targetBranchId = (reqBranchId && scopedBranchIds.includes(reqBranchId))
                    ? reqBranchId
                    : scopedBranchIds[0];
            } else if (user.branchId) {
                targetBranchId = user.branchId;
            } else {
                // If head office or unrestricted, find first available branch
                const firstBranch = await prisma.branch.findFirst({
                    where: { isActive: true },
                    select: { id: true },
                    orderBy: { code: 'asc' },
                });
                targetBranchId = firstBranch?.id || null;
            }

            if (!targetBranchId) {
                return errorResponse('No branch available or assigned', 400);
            }

            const branch = await prisma.branch.findUnique({
                where: { id: targetBranchId },
                select: { id: true, name: true, code: true },
            });

            if (!branch) {
                return errorResponse('Branch not found', 404);
            }

            // 2. Compute Range Bounds in IST
            const { dayStartUtc: mStartUtc } = getUtcBoundsForBranchCalendarDay(rangeStartDateLocal, 'Asia/Kolkata');
            const { dayEndUtc: mEndUtc } = getUtcBoundsForBranchCalendarDay(rangeEndDateLocal, 'Asia/Kolkata');

            // 3. Generate Calendar Days Metadata
            const schedule = await getWeekConfiguration(targetBranchId);

            const calendarDays: any[] = [];
            for (let i = 0; i < totalDays; i++) {
                const dayDateLocal = new Date(rangeStartDateLocal.getTime() + i * 24 * 60 * 60 * 1000);
                const dateYmd = getKolkataCalendarYmd(dayDateLocal);
                const dayOfMonth = dayDateLocal.getUTCDate();
                const dayOfWeekIdx = dayDateLocal.getUTCDay();
                const dayOfWeek = WEEKDAY_NAMES[dayOfWeekIdx];
                const dayOfWeekShort = WEEKDAY_SHORT[dayOfWeekIdx];

                const dayKey = dayOfWeek.toLowerCase() as keyof typeof schedule;
                const isWorkingDay = schedule[dayKey] ?? true;
                const isWeeklyOff = !isWorkingDay;
                const isToday = dateYmd === todayYmd;
                const isFuture = dateYmd > todayYmd;

                calendarDays.push({
                    day: dayOfMonth,
                    date: dateYmd,
                    dayOfWeek,
                    dayOfWeekShort,
                    isWeeklyOff,
                    isToday,
                    isFuture,
                });
            }

            // 4. Query Employees in Branch
            const employees = await prisma.user.findMany({
                where: {
                    branchId: targetBranchId,
                    isActive: true,
                },
                select: {
                    id: true,
                    employeeId: true,
                    firstName: true,
                    lastName: true,
                    role: true,
                    designation: { select: { name: true } },
                },
                orderBy: [{ employeeId: 'asc' }, { firstName: 'asc' }],
            });

            const employeeIds = employees.map((e) => e.id);

            // 5. Concurrently Query Attendance & Approved Leaves
            const [attendanceRecords, approvedLeaves] = await Promise.all([
                prisma.attendance.findMany({
                    where: {
                        userId: { in: employeeIds },
                        date: { gte: mStartUtc, lte: mEndUtc },
                    },
                    select: {
                        id: true,
                        userId: true,
                        date: true,
                        status: true,
                        checkIn: true,
                        checkOut: true,
                        workingHours: true,
                        isHalfDayLeave: true,
                        isHoliday: true,
                        leaveTypeId: true,
                        leaveType: {
                            select: { id: true, leaveType: true, isLop: true },
                        },
                    },
                }),
                prisma.leaveApplication.findMany({
                    where: {
                        employeeId: { in: employeeIds },
                        status: 'APPROVED',
                        fromDate: { lte: mEndUtc },
                        toDate: { gte: mStartUtc },
                    },
                    select: {
                        id: true,
                        employeeId: true,
                        fromDate: true,
                        toDate: true,
                        isHalfDay: true,
                        halfDaySession: true,
                        leaveType: {
                            select: { id: true, leaveType: true },
                        },
                    },
                }),
            ]);

            // Index attendance by `${userId}_${dateYmd}`
            const attendanceMap = new Map<string, typeof attendanceRecords[0]>();
            for (const att of attendanceRecords) {
                const dateYmd = getKolkataCalendarYmd(att.date);
                attendanceMap.set(`${att.userId}_${dateYmd}`, att);
            }

            // Index leaves by employeeId
            const leaveMap = new Map<string, typeof approvedLeaves>();
            for (const lv of approvedLeaves) {
                if (!leaveMap.has(lv.employeeId)) {
                    leaveMap.set(lv.employeeId, []);
                }
                leaveMap.get(lv.employeeId)!.push(lv);
            }

            // Helper to check approved leave for an employee on a specific dateYmd
            const getLeaveForDay = (empId: string, dayStartUtc: Date): typeof approvedLeaves[0] | null => {
                const list = leaveMap.get(empId);
                if (!list) return null;
                for (const lv of list) {
                    const { dayStartUtc: fUtc } = getUtcBoundsForBranchCalendarDay(lv.fromDate, 'Asia/Kolkata');
                    const { dayStartUtc: tUtc } = getUtcBoundsForBranchCalendarDay(lv.toDate, 'Asia/Kolkata');
                    if (dayStartUtc.getTime() >= fUtc.getTime() && dayStartUtc.getTime() <= tUtc.getTime()) {
                        return lv;
                    }
                }
                return null;
            };

            // 6. Build Matrix Data per Employee
            let branchPresentCount = 0;
            let branchHalfDayCount = 0;
            let branchAbsentCount = 0;
            let branchLeaveCount = 0;

            const employeeRows = employees.map((emp) => {
                let presentDays = 0;
                let halfDays = 0;
                let absentDays = 0;
                let leaveDays = 0;
                let holidays = 0;
                let weeklyOffs = 0;
                let totalWorkingHours = 0;

                const daysData: Record<string, {
                    day: number;
                    status: 'PRESENT' | 'HALF_DAY' | 'ABSENT' | 'ON_LEAVE' | 'HOLIDAY' | 'WEEKLY_OFF' | 'UPCOMING';
                    badge: 'P' | 'HD' | 'A' | 'L' | 'H' | 'WO' | '-';
                    checkInTime: string | null;
                    checkOutTime: string | null;
                    workingHours: number | null;
                    leaveTypeName: string | null;
                    isHalfDayLeave: boolean;
                }> = {};

                for (const cDay of calendarDays) {
                    const att = attendanceMap.get(`${emp.id}_${cDay.date}`);
                    const [cdY, cdM, cdD] = cDay.date.split('-').map(Number);
                    const dayLocal = new Date(Date.UTC(cdY, cdM - 1, cdD, 12, 0, 0));
                    const { dayStartUtc } = getUtcBoundsForBranchCalendarDay(dayLocal, 'Asia/Kolkata');
                    const appLeave = getLeaveForDay(emp.id, dayStartUtc);

                    let status: 'PRESENT' | 'HALF_DAY' | 'ABSENT' | 'ON_LEAVE' | 'HOLIDAY' | 'WEEKLY_OFF' | 'UPCOMING';
                    let badge: 'P' | 'HD' | 'A' | 'L' | 'H' | 'WO' | '-';
                    let checkInTime = null;
                    let checkOutTime = null;
                    let workingHours = null;
                    let leaveTypeName = null;
                    let isHalfDayLeave = false;

                    if (att) {
                        checkInTime = formatTime12h(att.checkIn);
                        checkOutTime = formatTime12h(att.checkOut);
                        workingHours = att.workingHours ? Number(Number(att.workingHours).toFixed(2)) : null;
                        isHalfDayLeave = Boolean(att.isHalfDayLeave);
                        leaveTypeName = att.leaveType?.leaveType || null;

                        if (workingHours) {
                            totalWorkingHours += workingHours;
                        }

                        if (att.isHoliday) {
                            status = 'HOLIDAY';
                            badge = 'H';
                            holidays++;
                        } else if (att.status === 'PRESENT') {
                            status = 'PRESENT';
                            badge = 'P';
                            presentDays++;
                            branchPresentCount++;
                        } else if (att.status === 'HALF_DAY') {
                            status = 'HALF_DAY';
                            badge = 'HD';
                            halfDays++;
                            branchHalfDayCount++;
                            if (att.isHalfDayLeave) {
                                leaveDays += 0.5;
                                branchLeaveCount += 0.5;
                            }
                        } else if (att.status === 'ABSENT' && (att.leaveTypeId || appLeave)) {
                            status = 'ON_LEAVE';
                            badge = 'L';
                            leaveDays += 1.0;
                            branchLeaveCount += 1.0;
                            leaveTypeName = leaveTypeName || appLeave?.leaveType?.leaveType || 'Leave';
                        } else {
                            status = 'ABSENT';
                            badge = 'A';
                            absentDays++;
                            branchAbsentCount++;
                        }
                    } else if (appLeave) {
                        // Covered by approved leave without punch record
                        status = 'ON_LEAVE';
                        badge = 'L';
                        leaveTypeName = appLeave.leaveType.leaveType;
                        isHalfDayLeave = Boolean(appLeave.isHalfDay);
                        const weight = appLeave.isHalfDay ? 0.5 : 1.0;
                        leaveDays += weight;
                        branchLeaveCount += weight;
                    } else if (cDay.isFuture) {
                        status = 'UPCOMING';
                        badge = '-';
                    } else if (cDay.isWeeklyOff) {
                        status = 'WEEKLY_OFF';
                        badge = 'WO';
                        weeklyOffs++;
                    } else {
                        // Past working day without punch or leave
                        status = 'ABSENT';
                        badge = 'A';
                        absentDays++;
                        branchAbsentCount++;
                    }

                    daysData[cDay.date] = {
                        day: cDay.day,
                        status,
                        badge,
                        checkInTime,
                        checkOutTime,
                        workingHours,
                        leaveTypeName,
                        isHalfDayLeave,
                    };
                }

                const paidDays = presentDays + (halfDays * 0.5) + leaveDays + weeklyOffs + holidays;

                return {
                    id: emp.id,
                    employeeId: emp.employeeId,
                    name: `${emp.firstName} ${emp.lastName}`.trim(),
                    designation: emp.designation?.name || emp.role,
                    role: emp.role,
                    days: daysData,
                    summary: {
                        presentDays,
                        halfDays,
                        absentDays,
                        leaveDays,
                        weeklyOffs,
                        holidays,
                        paidDays: Number(paidDays.toFixed(1)),
                        totalWorkingHours: Number(totalWorkingHours.toFixed(2)),
                    },
                };
            });

            return successResponse(
                {
                    branch: {
                        id: branch.id,
                        name: branch.name,
                        code: branch.code,
                    },
                    period: {
                        isCustomRange,
                        fromDate: resolvedFromDate,
                        tillDate: resolvedTillDate,
                        month: periodMonth,
                        year: periodYear,
                        monthName: periodMonthName,
                        totalDays,
                        days: calendarDays,
                    },
                    employees: employeeRows,
                    branchSummary: {
                        totalEmployees: employees.length,
                        totalPresent: branchPresentCount,
                        totalHalfDays: branchHalfDayCount,
                        totalAbsent: branchAbsentCount,
                        totalLeaves: Number(branchLeaveCount.toFixed(1)),
                    },
                },
                'Monthly attendance calendar retrieved successfully'
            );
        } catch (error) {
            console.error('[Monthly Attendance Calendar API] Error:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to retrieve attendance calendar',
                500
            );
        }
    })(request);
}
