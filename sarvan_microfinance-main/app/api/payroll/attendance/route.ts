import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import {
    errorResponse,
    successResponse,
    withAuth,
    handleCorsPreflight,
} from '@/app/lib/api-utils';
import { z } from 'zod';
import {
    getKolkataCalendarYmd,
    getKolkataDayEndExclusiveUtc,
    getUtcBoundsForBranchCalendarDay,
    parseKolkataAttendanceDateYmd,
} from '@/app/lib/branch-lock';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { autoCompleteSecondHalfLeavePunchOut, getKolkataMonthBounds } from '@/app/lib/attendance-leave-permission';
import { deriveDayStatusFromHours } from '@/app/lib/attendance-config';
import { getWorkingHours } from '@/app/lib/working-hours';
import { checkDayAttendanceAllowed } from '@/app/lib/attendance-schedule';
import { resolveDefaultShiftConfig, resolveEmployeeShiftConfig } from '@/app/lib/employee-shift';
import type { JWTPayload } from '@/app/lib/auth';

type ApprovedLeaveInfo = { leaveTypeName: string; isHalfDay: boolean; halfDaySession: 'FIRST_HALF' | 'SECOND_HALF' | null };

/** Batched version of getApprovedLeaveForDay for a whole branch register —
 * one query for every employee's APPROVED leave, matched in JS the same way
 * (LeaveApplication.fromDate/toDate aren't pre-normalized to IST day-start).
 * A half-day leave never locks the row (see attendance-hr/plan-half-day-leave.md
 * §6b) — real attendance data can still legitimately exist for the working half. */
async function getApprovedLeaveByEmployeeForDay(
    employeeIds: string[],
    dayStartUtc: Date,
): Promise<Map<string, ApprovedLeaveInfo>> {
    const approvedLeaves = await prisma.leaveApplication.findMany({
        where: { employeeId: { in: employeeIds }, status: 'APPROVED' },
        select: { employeeId: true, fromDate: true, toDate: true, isHalfDay: true, halfDaySession: true, leaveType: { select: { leaveType: true } } },
    });
    const byEmployee = new Map<string, ApprovedLeaveInfo>();
    for (const lv of approvedLeaves) {
        const { dayStartUtc: from } = getUtcBoundsForBranchCalendarDay(lv.fromDate);
        const { dayStartUtc: to } = getUtcBoundsForBranchCalendarDay(lv.toDate);
        if (dayStartUtc.getTime() >= from.getTime() && dayStartUtc.getTime() <= to.getTime()) {
            byEmployee.set(lv.employeeId, { leaveTypeName: lv.leaveType.leaveType, isHalfDay: lv.isHalfDay, halfDaySession: lv.halfDaySession });
        }
    }
    return byEmployee;
}

// ─── Validation Schema ───────────────────────────────────────────────────────

const saveAttendanceSchema = z.object({
    attendanceDate: z.string().min(1, 'Date is required'),
    branchId: z.string().optional(),
    employees: z.array(
        z.object({
            employeeId: z.string().min(1, 'Employee ID is required'),
            status: z.string().nullable().optional(),
            leaveTypeId: z.string().nullable().optional(),
        })
    ),
});

/** A page-local branchId override is honored only when the caller is actually
 * permitted to see that branch — mirrors resolveScopedBranchIds' fail-safe. */
async function resolveRequestedBranchId(
    user: JWTPayload,
    requestedBranchId: string | null | undefined
): Promise<{ branchId?: string; forbidden?: boolean }> {
    if (!requestedBranchId) return {};
    const permittedBranchIds = await getPermittedBranchIds(user);
    if (permittedBranchIds === null || permittedBranchIds.includes(requestedBranchId)) {
        return { branchId: requestedBranchId };
    }
    return { forbidden: true };
}

// ─── CORS Preflight ──────────────────────────────────────────────────────────

export async function OPTIONS() {
    return handleCorsPreflight();
}

// ─── GET: Fetch employees with their attendance for a given date ─────────────

export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            let dateStr = searchParams.get('date');

            // Resolve branchId: explicit page-local filter (ADMIN/AREA_MANAGER only,
            // validated against permitted branches) → JWT token → X-Branch-Id header → DB lookup
            // "All Branches" (?branchId=all) is a read-only, multi-branch view of one day's
            // attendance across every branch the caller may see — saving still needs one branch.
            const isAllBranches = searchParams.get('branchId') === 'all';
            const allBranchScope = isAllBranches ? await getPermittedBranchIds(user) : null;

            const requested = isAllBranches
                ? ({} as { branchId?: string; forbidden?: boolean })
                : await resolveRequestedBranchId(user, searchParams.get('branchId'));
            if (requested.forbidden) {
                return errorResponse('You do not have access to this branch', 403);
            }
            let branchId = requested.branchId ?? user.branchId;
            if (isAllBranches) branchId = 'all'; // sentinel only — every branch-specific lookup below is skipped

            if (!branchId) {
                // Fallback: check X-Branch-Id header (sent by frontend apiClient)
                branchId = req.headers.get('x-branch-id') || undefined;
            }

            if (!branchId) {
                // Final fallback: look up the user's branch from the DB
                const dbUser = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: { branchId: true },
                });
                branchId = dbUser?.branchId || undefined;
            }

            if (!branchId) {
                return errorResponse('No branch assigned to the current user', 403);
            }

            const lock = isAllBranches
                ? null
                : await prisma.branchLock.findUnique({
                    where: { branchId },
                    select: { currentWorkingDate: true },
                });
            const workingInstant = lock?.currentWorkingDate
                ? new Date(lock.currentWorkingDate)
                : new Date();
            const branchWorkingDateYmd = getKolkataCalendarYmd(workingInstant);

            if (!dateStr) {
                dateStr = branchWorkingDateYmd;
            }

            let attendanceDate: Date;
            try {
                attendanceDate = parseKolkataAttendanceDateYmd(dateStr);
            } catch {
                return errorResponse('Invalid date format (use YYYY-MM-DD)', 400);
            }

            // Fetch only employees belonging to the resolved branch
            const { month: registerMonth, year: registerYear } = getKolkataMonthBounds(attendanceDate);
            const employees = await prisma.user.findMany({
                where: {
                    ...(isAllBranches
                        ? { branchId: allBranchScope ? { in: allBranchScope } : { not: null } }
                        : { branchId: branchId }),
                    isActive: true,
                },
                select: {
                    id: true,
                    employeeId: true,
                    firstName: true,
                    lastName: true,
                    role: true,
                    branchId: true,
                    branch: { select: { id: true, name: true, code: true } },
                    leaveBalances: {
                        where: { isActive: true, month: registerMonth, year: registerYear, leaveType: { isActive: true } },
                        select: {
                            leaveTypeId: true,
                            remainingBalance: true,
                        },
                    },
                    shift: {
                        select: { id: true, name: true, shiftStart: true, shiftEnd: true, graceMinutes: true, isActive: true },
                    },
                },
                orderBy: isAllBranches ? [{ branch: { name: 'asc' } }, { firstName: 'asc' }] : { firstName: 'asc' },
            });

            const { dayStartUtc } = getUtcBoundsForBranchCalendarDay(attendanceDate, 'Asia/Kolkata');
            const dayEndExclusiveUtc = getKolkataDayEndExclusiveUtc(dayStartUtc);

            // Lazy fallback for a Second-Half leave day nobody ever punched out of —
            // only relevant once the date has passed (today's own boundary check
            // already happens live via the tracking-ping trigger). See plan §6.
            if (dayStartUtc.getTime() < getUtcBoundsForBranchCalendarDay(new Date(), 'Asia/Kolkata').dayStartUtc.getTime()) {
                await Promise.all(
                    employees.map((e) =>
                        autoCompleteSecondHalfLeavePunchOut({ employeeId: e.id, dayStartUtc }).catch((err) =>
                            console.error('[Attendance GET] Auto punch-out check failed:', err),
                        ),
                    ),
                );
            }

            // Half-open [start, nextStart) — same calendar day as EOD; matches canonical + legacy anchors
            const attendanceRows = await prisma.attendance.findMany({
                where: {
                    userId: { in: employees.map((e) => e.id) },
                    date: { gte: dayStartUtc, lt: dayEndExclusiveUtc },
                },
                select: {
                    userId: true,
                    status: true,
                    leaveTypeId: true,
                    isHoliday: true,
                    checkIn: true,
                    checkOut: true,
                    updatedAt: true,
                },
                orderBy: { updatedAt: 'desc' },
            });

            const attendanceMap = new Map<
                string,
                {
                    userId: string;
                    status: string;
                    leaveTypeId: string | null;
                    isHoliday: boolean;
                    checkIn: Date | null;
                    checkOut: Date | null;
                }
            >();
            for (const r of attendanceRows) {
                if (!attendanceMap.has(r.userId)) {
                    attendanceMap.set(r.userId, {
                        userId: r.userId,
                        status: r.status,
                        leaveTypeId: r.leaveTypeId,
                        isHoliday: r.isHoliday,
                        checkIn: r.checkIn,
                        checkOut: r.checkOut,
                    });
                }
            }

            // A whole-day APPROVED leave locks that employee's row — the register
            // shows "Approved Leave" instead of editable radios, and the POST
            // handler below refuses to change their status while it holds. A
            // half-day leave never locks the row (plan §6b) — shown as a badge
            // instead, since real attendance can still exist for the working half.
            const approvedLeaveByEmployee = await getApprovedLeaveByEmployeeForDay(
                employees.map((e) => e.id),
                dayStartUtc,
            );

            // Merge employees with their attendance
            // Single-branch: one day-type for the whole register. All-branches: each branch has its own
            // calendar, so weekly-off / holiday is resolved per branch and applied per employee row.
            const dayInfoByBranch = new Map<string, Awaited<ReturnType<typeof checkDayAttendanceAllowed>>>();
            if (isAllBranches) {
                const branchIdsInView = Array.from(new Set(employees.map((e) => e.branchId).filter((id): id is string => !!id)));
                await Promise.all(
                    branchIdsInView.map(async (id) => {
                        dayInfoByBranch.set(id, await checkDayAttendanceAllowed(attendanceDate, id));
                    }),
                );
            }
            const singleDay = isAllBranches
                ? { isWorkingDay: true, reason: undefined, dayType: 'WORKING' as const, dayNote: undefined }
                : await checkDayAttendanceAllowed(attendanceDate, branchId || '');
            const { isWorkingDay, reason: dayReason, dayType, dayNote } = singleDay;
            const isWeeklyOff = !isWorkingDay;
            const defaultShift = await resolveDefaultShiftConfig();
            const result = employees.map((emp) => {
                const record = attendanceMap.get(emp.id);
                const approvedLeave = approvedLeaveByEmployee.get(emp.id) ?? null;
                // The employee's own assigned shift (Shift Management) if active, else the
                // shift flagged as default — same resolution rule as resolveEmployeeShiftConfig,
                // computed here in-memory (shift already loaded above) to avoid an N+1 query.
                const resolvedShift = emp.shift?.isActive
                    ? { id: emp.shift.id, name: emp.shift.name, shiftStart: emp.shift.shiftStart, shiftEnd: emp.shift.shiftEnd, graceMinutes: emp.shift.graceMinutes }
                    : { id: defaultShift.shiftId, name: defaultShift.shiftName, shiftStart: defaultShift.shiftStart, shiftEnd: defaultShift.shiftEnd, graceMinutes: defaultShift.graceMinutes };
                return {
                    id: emp.id,
                    employeeId: emp.employeeId || emp.id.substring(0, 8).toUpperCase(),
                    firstName: emp.firstName,
                    lastName: emp.lastName,
                    designation: emp.role,
                    shift: resolvedShift,
                    branch: emp.branch ? { id: emp.branch.id, name: emp.branch.name, code: emp.branch.code } : null,
                    status: record?.status
                        || ((isAllBranches ? (emp.branchId && dayInfoByBranch.get(emp.branchId)?.isWorkingDay === false) : isWeeklyOff) ? 'WEEKLY_OFF' : null),
                    leaveTypeId: record?.leaveTypeId || null,
                    isHoliday: record?.isHoliday || false,
                    leaveBalances: (emp.leaveBalances || []).map((lb) => ({
                        leaveTypeId: lb.leaveTypeId,
                        remainingBalance: Math.round(Number(lb.remainingBalance) || 0),
                    })),
                    // Only a whole-day leave locks the row (see above) — this stays
                    // non-null only in that case so existing frontend logic that
                    // checks `approvedLeaveType` to lock a row doesn't change.
                    approvedLeaveType: approvedLeave && !approvedLeave.isHalfDay ? approvedLeave.leaveTypeName : null,
                    // Half-day leave is always surfaced as a badge, row stays editable.
                    halfDayLeave: approvedLeave?.isHalfDay
                        ? { leaveTypeName: approvedLeave.leaveTypeName, session: approvedLeave.halfDaySession }
                        : null,
                    checkIn: record?.checkIn ? record.checkIn.toISOString() : null,
                    checkOut: record?.checkOut ? record.checkOut.toISOString() : null,
                };
            });

            return successResponse(
                {
                    employees: result,
                    branchWorkingDateYmd,
                    selectedDateYmd: dateStr,
                    isAllBranches,
                    isWeeklyOff,
                    weeklyOffReason: dayReason ?? null,
                    dayType,
                    dayNote: dayNote ?? null,
                    // Default-shift values kept at top level for backward compatibility —
                    // per-employee diff/shift display should prefer each row's own `shift` field.
                    shiftStart: defaultShift.shiftStart,
                    shiftEnd: defaultShift.shiftEnd,
                    graceMinutes: defaultShift.graceMinutes,
                },
                'Attendance records fetched successfully'
            );
        } catch (error: unknown) {
            console.error('[Attendance GET] Error:', error);
            const message =
                error instanceof Error ? error.message : 'Failed to fetch attendance';
            return errorResponse(message, 500);
        }
    })(request);
}

// ─── POST: Save / Update attendance for a date ──────────────────────────────

export async function POST(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const body = await req.json();
            const validation = saveAttendanceSchema.safeParse(body);

            if (!validation.success) {
                return errorResponse(validation.error.errors[0].message, 400);
            }

            const { attendanceDate: attendanceDateStr, employees, branchId: requestedBranchId } = validation.data;

            let targetDate: Date;
            try {
                targetDate = parseKolkataAttendanceDateYmd(attendanceDateStr);
            } catch {
                return errorResponse('Invalid attendance date (use YYYY-MM-DD)', 400);
            }

            const { dayStartUtc: dayStartBound } = getUtcBoundsForBranchCalendarDay(
                targetDate,
                'Asia/Kolkata'
            );
            const dayEndExclusiveBound = getKolkataDayEndExclusiveUtc(dayStartBound);

            // Resolve branchId: explicit page-local filter (ADMIN/AREA_MANAGER only,
            // validated against permitted branches) → JWT token → X-Branch-Id header → DB lookup
            const requested = await resolveRequestedBranchId(user, requestedBranchId);
            if (requested.forbidden) {
                return errorResponse('You do not have access to this branch', 403);
            }
            let branchId = requested.branchId ?? user.branchId;

            if (!branchId) {
                branchId = req.headers.get('x-branch-id') || undefined;
            }

            if (!branchId) {
                const dbUser = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: { branchId: true },
                });
                branchId = dbUser?.branchId || undefined;
            }

            if (!branchId) {
                return errorResponse('No branch assigned to the current user', 403);
            }

            // Employees on a whole-day APPROVED leave are locked — the portal must
            // not let anyone hand-override "Approved Leave" (mirrors the punch-in
            // block in face/verify and device-biometric). A half-day leave doesn't
            // lock the row (plan §6b) — the admin can still mark/correct the
            // working half's attendance normally.
            const approvedLeaveByEmployee = await getApprovedLeaveByEmployeeForDay(
                employees.map((e) => e.employeeId),
                dayStartBound,
            );
            const lockedEmployeeIds = new Set(
                Array.from(approvedLeaveByEmployee.entries())
                    .filter(([, info]) => !info.isHalfDay)
                    .map(([employeeId]) => employeeId),
            );

            // Respects the branch's Week Configuration and Holiday Calendar: week-offs and
            // holidays are locked unless the Holiday Calendar made the date a working day.
            const { isWorkingDay, reason: dayReason } = await checkDayAttendanceAllowed(targetDate, branchId);
            if (!isWorkingDay) {
                return errorResponse(
                    dayReason || 'This date is a Weekly Off or Holiday and locked. To enable attendance for this date, mark it as a Working Day in the Holiday Calendar.',
                    400
                );
            }

            // Auto Punch-Out (Working Hours page): an open punch (checkIn set,
            // checkOut still null) gets closed at this time when a PAST date's
            // register is saved — never today's, since the employee may still be
            // expected to punch out later. Mirrors a real punch-out's own
            // workingHours/status computation exactly.
            const { dayStartUtc: todayStartBound } = getUtcBoundsForBranchCalendarDay(new Date(), 'Asia/Kolkata');
            const isPastDay = dayStartBound.getTime() < todayStartBound.getTime();
            const autoCheckoutTime = (await getWorkingHours()).autoCheckoutTime;
            const [autoCheckoutHour, autoCheckoutMinute] = autoCheckoutTime.split(':').map(Number);

            await prisma.$transaction(async (tx) => {
                for (const emp of employees) {
                    if (lockedEmployeeIds.has(emp.employeeId)) continue;

                    // No status was explicitly set for this employee (no punch, no manual
                    // pick) — default to ABSENT rather than assuming Present. A real punch
                    // (face/verify, device-biometric) always writes PRESENT/FULL_DAY itself;
                    // this fallback only fires for a day this register saves untouched.
                    let status = (emp.status || 'ABSENT').toUpperCase();

                    const rows = await tx.attendance.findMany({
                        where: {
                            userId: emp.employeeId,
                            date: { gte: dayStartBound, lt: dayEndExclusiveBound },
                        },
                        orderBy: { updatedAt: 'desc' },
                        select: { id: true, checkIn: true, checkOut: true },
                    });

                    if (rows.length > 1) {
                        await tx.attendance.deleteMany({
                            where: { id: { in: rows.slice(1).map((r) => r.id) } },
                        });
                    }

                    const primary = rows[0];

                    // Auto-close an open punch — only for a genuinely past day.
                    let autoCheckoutData: { checkOut: Date; workingHours: number } | null = null;
                    if (primary?.checkIn && !primary.checkOut && isPastDay) {
                        const checkOutAt = new Date(dayStartBound.getTime() + (autoCheckoutHour * 60 + autoCheckoutMinute) * 60 * 1000);
                        const netHours = Math.max(0, (checkOutAt.getTime() - primary.checkIn.getTime()) / (1000 * 60 * 60));
                        const workingHours = Math.round(netHours * 100) / 100;
                        const shiftConfig = await resolveEmployeeShiftConfig(emp.employeeId);
                        status = deriveDayStatusFromHours(workingHours, shiftConfig);
                        autoCheckoutData = { checkOut: checkOutAt, workingHours };
                    }

                    if (primary) {
                        await tx.attendance.update({
                            where: { id: primary.id },
                            data: {
                                date: targetDate,
                                status: status as 'PRESENT' | 'ABSENT' | 'HALF_DAY' | 'HOLIDAY',
                                leaveTypeId: emp.leaveTypeId || null,
                                isHoliday: false,
                                branchId,
                                ...(autoCheckoutData ? { checkOut: autoCheckoutData.checkOut, workingHours: autoCheckoutData.workingHours } : {}),
                            },
                        });
                    } else {
                        await tx.attendance.create({
                            data: {
                                userId: emp.employeeId,
                                date: targetDate,
                                status: status as 'PRESENT' | 'ABSENT' | 'HALF_DAY' | 'HOLIDAY',
                                leaveTypeId: emp.leaveTypeId || null,
                                isHoliday: false,
                                branchId,
                            },
                        });
                    }
                }
            });

            return successResponse(null, 'Attendance recorded successfully');
        } catch (error: unknown) {
            console.error('[Attendance POST] Error:', error);
            const message =
                error instanceof Error ? error.message : 'Failed to record attendance';
            return errorResponse(message, 500);
        }
    })(request);
}
