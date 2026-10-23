import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { getUtcBoundsForBranchCalendarDay, getKolkataCalendarYmd } from '@/app/lib/branch-lock';
import { resolveLopLeaveType } from '@/app/lib/attendance-leave-permission';

export async function OPTIONS() {
    return handleCorsPreflight();
}

type Period = 'thisWeek' | 'thisMonth' | 'thisYear';

/** IST calendar-day bounds for the Monday→Sunday week / 1st→last day month /
 * Jan 1→Dec 31 year containing `referenceDate`. Full period, not "up to
 * today" — simpler, and equivalent in practice since future dates have no
 * data yet. */
function getPeriodBoundsUtc(referenceDate: Date): Record<Period, { startUtc: Date; endExclusiveUtc: Date }> {
    const [y, m, d] = getKolkataCalendarYmd(referenceDate).split('-').map(Number);
    const istNoonUtcForYmd = (year: number, month: number, day: number) => new Date(Date.UTC(year, month - 1, day, 12)); // noon avoids any DST/offset edge case before day-bounding

    // Week: Monday-start. getDay() on a UTC noon instant for an IST calendar
    // date still reflects the correct weekday since noon UTC = ~5:30pm IST,
    // same calendar day either way.
    const weekdayIndex = (istNoonUtcForYmd(y, m, d).getUTCDay() + 6) % 7; // 0=Mon..6=Sun
    const weekStart = new Date(istNoonUtcForYmd(y, m, d).getTime() - weekdayIndex * 24 * 60 * 60 * 1000);
    const weekEnd = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000);

    const monthStart = istNoonUtcForYmd(y, m, 1);
    const monthEnd = new Date(Date.UTC(y, m, 0, 12)); // day 0 of next month = last day of this month

    const yearStart = istNoonUtcForYmd(y, 1, 1);
    const yearEnd = istNoonUtcForYmd(y, 12, 31);

    const bound = (noonInstant: Date, isEnd: boolean) => {
        const { dayStartUtc, dayEndUtc } = getUtcBoundsForBranchCalendarDay(noonInstant);
        return isEnd ? new Date(dayEndUtc.getTime() + 1) : dayStartUtc; // endExclusive
    };

    return {
        thisWeek: { startUtc: bound(weekStart, false), endExclusiveUtc: bound(weekEnd, true) },
        thisMonth: { startUtc: bound(monthStart, false), endExclusiveUtc: bound(monthEnd, true) },
        thisYear: { startUtc: bound(yearStart, false), endExclusiveUtc: bound(yearEnd, true) },
    };
}

// GET /api/hr/employees/[id]/summary — per-employee leave/permission/attendance
// summary for This Week / This Month / This Year (IST calendar periods).
//
// Definitions (documented since this session found several subtle counting
// bugs in "days used" logic elsewhere — see attendance-hr/plan-half-day-leave.md §9):
//  - leave.totalDays / leave.lopDays: Attendance rows with a non-null
//    leaveTypeId in the period, weighted 0.5 if `isHalfDayLeave`, 1
//    otherwise — same weighting as getRemainingLeaveBalance(), so these
//    numbers agree with the Leave Balance page. lopDays is the subset tagged
//    with the currently-configured LOP leave type.
//  - permission: the actual PermissionRequest list for the period (APPROVED
//    only), plus a count/totalHours rollup.
//  - attendance.presentDays: PRESENT status rows (regardless of
//    whether the day was also a half-day leave — they were still physically
//    present for part/all of it). attendance.absentDays: ABSENT status rows
//    with NO leaveTypeId — a genuine unexplained absence, distinct from an
//    approved-leave day (which is already counted under `leave`, not here).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    return withAuth(async (req, user) => {
        try {
            const { id } = await params;
            const employee = await prisma.user.findUnique({
                where: { id },
                select: { id: true, employeeId: true, firstName: true, lastName: true, branchId: true },
            });
            if (!employee) return errorResponse('Employee not found', 404);

            const permittedBranchIds = await getPermittedBranchIds(user);
            if (permittedBranchIds && (!employee.branchId || !permittedBranchIds.includes(employee.branchId))) {
                return errorResponse('You do not have access to this employee', 403);
            }

            const periods = getPeriodBoundsUtc(new Date());
            const lopType = await resolveLopLeaveType();

            const [attendanceRows, permissionRows] = await Promise.all([
                prisma.attendance.findMany({
                    where: { userId: id, date: { gte: periods.thisYear.startUtc, lt: periods.thisYear.endExclusiveUtc } },
                    select: { date: true, status: true, leaveTypeId: true, isHalfDayLeave: true },
                }),
                prisma.permissionRequest.findMany({
                    where: { employeeId: id, status: 'APPROVED', date: { gte: periods.thisYear.startUtc, lt: periods.thisYear.endExclusiveUtc } },
                    select: {
                        id: true, date: true, fromTime: true, toTime: true, hours: true,
                        permissionType: { select: { permissionType: true } },
                    },
                    orderBy: { date: 'desc' },
                }),
            ]);

            const inPeriod = (date: Date, period: Period) =>
                date.getTime() >= periods[period].startUtc.getTime() && date.getTime() < periods[period].endExclusiveUtc.getTime();

            const summarizeLeave = (period: Period) => {
                const rows = attendanceRows.filter((r) => r.leaveTypeId && inPeriod(r.date, period));
                const totalDays = rows.reduce((sum, r) => sum + (r.isHalfDayLeave ? 0.5 : 1), 0);
                const lopDays = lopType
                    ? rows.filter((r) => r.leaveTypeId === lopType.id).reduce((sum, r) => sum + (r.isHalfDayLeave ? 0.5 : 1), 0)
                    : 0;
                return { totalDays, lopDays };
            };

            const summarizePermission = (period: Period) => {
                const requests = permissionRows.filter((r) => inPeriod(r.date, period));
                const totalHours = requests.reduce((sum, r) => sum + Number(r.hours), 0);
                return {
                    count: requests.length,
                    totalHours: Math.round(totalHours * 100) / 100,
                    requests: requests.map((r) => ({
                        id: r.id,
                        date: r.date.toISOString(),
                        fromTime: r.fromTime,
                        toTime: r.toTime,
                        hours: Number(r.hours),
                        permissionType: r.permissionType.permissionType,
                    })),
                };
            };

            const summarizeAttendance = (period: Period) => {
                const rows = attendanceRows.filter((r) => inPeriod(r.date, period));
                const presentDays = rows.filter((r) => r.status === 'PRESENT').length;
                const halfDays = rows.filter((r) => r.status === 'HALF_DAY').length;
                const absentDays = rows.filter((r) => r.status === 'ABSENT' && !r.leaveTypeId).length;
                return { presentDays, halfDays, absentDays };
            };

            return successResponse({
                employee: {
                    id: employee.id,
                    employeeId: employee.employeeId,
                    name: `${employee.firstName} ${employee.lastName}`,
                },
                leave: {
                    thisWeek: summarizeLeave('thisWeek'),
                    thisMonth: summarizeLeave('thisMonth'),
                    thisYear: summarizeLeave('thisYear'),
                },
                permission: {
                    thisWeek: summarizePermission('thisWeek'),
                    thisMonth: summarizePermission('thisMonth'),
                    thisYear: summarizePermission('thisYear'),
                },
                attendance: {
                    thisWeek: summarizeAttendance('thisWeek'),
                    thisMonth: summarizeAttendance('thisMonth'),
                    thisYear: summarizeAttendance('thisYear'),
                },
            }, 'Employee summary fetched successfully');
        } catch (error: any) {
            console.error('Error fetching employee summary:', error);
            return errorResponse(error.message || 'Failed to fetch employee summary', 500);
        }
    })(request);
}
