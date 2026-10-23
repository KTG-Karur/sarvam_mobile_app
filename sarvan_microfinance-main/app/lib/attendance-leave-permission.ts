import { prisma } from '@/app/lib/db';
import type { Prisma } from '@prisma/client';
import { getUtcBoundsForBranchCalendarDay } from '@/app/lib/branch-lock';
import { deriveDayStatusFromHours, type WorkingHoursConfig } from '@/app/lib/attendance-config';
import { resolveEmployeeShiftConfig, type ResolvedShiftConfig } from '@/app/lib/employee-shift';

/** Wall-clock minutes-since-midnight (Asia/Kolkata) for a given instant. */
function kolkataMinutesOfDay(instant: Date): number {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata', hour12: false, hour: '2-digit', minute: '2-digit',
    }).formatToParts(instant);
    const h = Number(parts.find((p) => p.type === 'hour')?.value || 0);
    const m = Number(parts.find((p) => p.type === 'minute')?.value || 0);
    return h * 60 + m;
}

function minutesFromHHMM(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
}

/**
 * First Half / Second Half session windows, split at the shift midpoint —
 * see attendance-hr/plan-half-day-leave.md §3c and attendance-hr/plan-multi-shift.md.
 * Takes the employee's own resolved shift config (via resolveEmployeeShiftConfig) so
 * two employees on different shifts get different First/Second-Half windows.
 */
export function getHalfDaySessionWindow(
    session: 'FIRST_HALF' | 'SECOND_HALF',
    shiftConfig: Pick<WorkingHoursConfig, 'shiftStart' | 'shiftEnd'>,
): { startMinutes: number; endMinutes: number } {
    const { shiftStart, shiftEnd } = shiftConfig;
    const start = minutesFromHHMM(shiftStart);
    const end = minutesFromHHMM(shiftEnd);
    const midpoint = start + (end - start) / 2;
    return session === 'FIRST_HALF' ? { startMinutes: start, endMinutes: midpoint } : { startMinutes: midpoint, endMinutes: end };
}

/** Formats a minutes-of-day value as "h:mm AM/PM" for user-facing messages. */
function formatMinutesOfDay(totalMinutes: number): string {
    const h24 = Math.floor(totalMinutes / 60) % 24;
    const m = Math.round(totalMinutes % 60);
    const period = h24 >= 12 ? 'PM' : 'AM';
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function isWithinSessionWindow(instant: Date, session: 'FIRST_HALF' | 'SECOND_HALF', shiftConfig: Pick<WorkingHoursConfig, 'shiftStart' | 'shiftEnd'>): boolean {
    const { startMinutes, endMinutes } = getHalfDaySessionWindow(session, shiftConfig);
    const nowMinutes = kolkataMinutesOfDay(instant);
    return nowMinutes >= startMinutes && nowMinutes < endMinutes;
}

/**
 * Shared punch-time guards linking Attendance to the Leave / Permission flows:
 *  - an APPROVED leave for the day blocks punch-in (and manual marking in the
 *    web register) entirely — the day is "Approved Leave", not editable, until
 *    the leave is cancelled.
 *  - an APPROVED permission's hours are deducted from that day's worked hours
 *    on punch-out.
 * Both read live status, so cancelling a leave/permission (see the admin-cancel
 * routes) makes the day behave normally again on the very next request — no
 * separate "revert" step needed here.
 */

export type ApprovedLeaveForDay = { id: string; leaveTypeName: string; isHalfDay: boolean; halfDaySession: 'FIRST_HALF' | 'SECOND_HALF' | null };

/**
 * The APPROVED leave (if any) blocking punch-in at `attemptedAt` for this
 * employee on `targetDayStartUtc`. `LeaveApplication.fromDate`/`toDate` are
 * stored as raw coerced dates (not pre-normalized to IST day-start), so each
 * candidate is converted the same way the leave approve route's
 * `eachDayInRange` does, then compared.
 *
 * A whole-day leave blocks the entire day, as always. A half-day leave only
 * blocks punch-in inside its own session window (First/Second Half, split at
 * the shift midpoint) — outside that window it does NOT block, so `attemptedAt`
 * defaults to "now" but callers doing a day-level check unrelated to an actual
 * punch attempt (e.g. the register's read-only "is this day covered" display)
 * can still pass the day start and get whole-day-equivalent behavior for
 * half-day rows by checking `isHalfDay`/`halfDaySession` on the result instead.
 */
export async function getApprovedLeaveForDay(
    employeeId: string,
    targetDayStartUtc: Date,
    attemptedAt: Date = new Date(),
): Promise<ApprovedLeaveForDay | null> {
    const candidates = await prisma.leaveApplication.findMany({
        where: { employeeId, status: 'APPROVED' },
        select: { id: true, fromDate: true, toDate: true, isHalfDay: true, halfDaySession: true, leaveType: { select: { leaveType: true } } },
    });
    // Only needed if a half-day candidate actually exists — resolved lazily so a whole-day-only
    // employee never pays for a shift lookup.
    let shiftConfig: ResolvedShiftConfig | null = null;
    for (const c of candidates) {
        const { dayStartUtc: from } = getUtcBoundsForBranchCalendarDay(c.fromDate);
        const { dayStartUtc: to } = getUtcBoundsForBranchCalendarDay(c.toDate);
        if (targetDayStartUtc.getTime() >= from.getTime() && targetDayStartUtc.getTime() <= to.getTime()) {
            if (!c.isHalfDay) {
                return { id: c.id, leaveTypeName: c.leaveType.leaveType, isHalfDay: false, halfDaySession: null };
            }
            if (!shiftConfig) shiftConfig = await resolveEmployeeShiftConfig(employeeId);
            if (c.halfDaySession && isWithinSessionWindow(attemptedAt, c.halfDaySession, shiftConfig)) {
                return { id: c.id, leaveTypeName: c.leaveType.leaveType, isHalfDay: true, halfDaySession: c.halfDaySession };
            }
            // Half-day leave, but the attempt falls outside its session window — doesn't block; keep checking other candidates.
        }
    }
    return null;
}

/** User-facing message for a punch-in blocked by a half-day leave, naming when it reopens. */
export function formatHalfDayLeaveBlockedMessage(leaveTypeName: string, session: 'FIRST_HALF' | 'SECOND_HALF', shiftConfig: Pick<WorkingHoursConfig, 'shiftStart' | 'shiftEnd'>): string {
    const { endMinutes } = getHalfDaySessionWindow(session, shiftConfig);
    const label = session === 'FIRST_HALF' ? 'First Half' : 'Second Half';
    return `Approved ${label} leave (${leaveTypeName}) — punch-in reopens after ${formatMinutesOfDay(endMinutes)}.`;
}

/** UTC instant for a given number of minutes-of-day past `dayStartUtc` (which itself anchors IST midnight). */
function utcInstantAtMinutesOfDay(dayStartUtc: Date, minutesOfDay: number): Date {
    return new Date(dayStartUtc.getTime() + minutesOfDay * 60 * 1000);
}

/**
 * Auto-closes a Second-Half leave day that's still checked in once the
 * session boundary (the shift midpoint) has passed — see
 * attendance-hr/plan-half-day-leave.md §6. Covers two gaps at once:
 *  - the employee never explicitly punches out (their leave covers the rest
 *    of the shift, so there's no reason to) — checkOut would otherwise stay
 *    null forever;
 *  - the employee keeps working past the boundary and would otherwise be
 *    able to punch out later having silently worked the whole day despite
 *    the approved (and already balance-deducted) half-day leave.
 *
 * Triggered from two call sites (see plan §6): primarily by the next
 * background tracking ping after the boundary (passing that ping's own
 * location as `lastKnownLocation`), with a lazy fallback from the Attendance
 * register's own GET for past dates (no `lastKnownLocation` — falls back to
 * the most recent ping before the boundary, or the punch-in's own location).
 * Safe to call speculatively/often: no-ops immediately if there's nothing to
 * close, and the actual write is guarded by a fresh re-check inside a
 * transaction so two near-simultaneous callers can't double-write.
 */
export async function autoCompleteSecondHalfLeavePunchOut(params: {
    employeeId: string;
    dayStartUtc: Date;
    lastKnownLocation?: { latitude: number; longitude: number } | null;
}): Promise<void> {
    const { employeeId, dayStartUtc, lastKnownLocation } = params;

    const secondHalfLeave = await prisma.leaveApplication.findFirst({
        where: {
            employeeId, status: 'APPROVED', isHalfDay: true, halfDaySession: 'SECOND_HALF',
            fromDate: { lte: dayStartUtc }, toDate: { gte: dayStartUtc },
        },
        select: { id: true },
    });
    if (!secondHalfLeave) return;

    const attendance = await prisma.attendance.findUnique({
        where: { userId_date: { userId: employeeId, date: dayStartUtc } },
    });
    if (!attendance || !attendance.checkIn || attendance.checkOut) return; // nothing to close

    const shiftConfig = await resolveEmployeeShiftConfig(employeeId);
    const { startMinutes: boundaryMinutes } = getHalfDaySessionWindow('SECOND_HALF', shiftConfig);
    const boundaryUtc = utcInstantAtMinutesOfDay(dayStartUtc, boundaryMinutes);
    if (boundaryUtc.getTime() > Date.now()) return; // boundary hasn't arrived yet for "today"

    let checkoutLat = lastKnownLocation?.latitude ?? null;
    let checkoutLng = lastKnownLocation?.longitude ?? null;
    if (checkoutLat == null || checkoutLng == null) {
        const lastPing = await prisma.employeeLocationPing.findFirst({
            where: { employeeId, capturedAt: { gte: dayStartUtc, lte: boundaryUtc } },
            orderBy: { capturedAt: 'desc' },
            select: { latitude: true, longitude: true },
        });
        checkoutLat = lastPing?.latitude ?? attendance.checkInLatitude ?? null;
        checkoutLng = lastPing?.longitude ?? attendance.checkInLongitude ?? null;
    }

    const workedHours = (boundaryUtc.getTime() - attendance.checkIn.getTime()) / (1000 * 60 * 60);
    const netHours = Math.max(0, Math.round(workedHours * 100) / 100);
    const status = deriveDayStatusFromHours(netHours, shiftConfig);

    await prisma.$transaction(async (tx) => {
        const fresh = await tx.attendance.findUnique({ where: { id: attendance.id } });
        if (!fresh || fresh.checkOut) return; // already closed by a racing caller
        await tx.attendance.update({
            where: { id: attendance.id },
            data: {
                checkOut: boundaryUtc, checkOutLatitude: checkoutLat, checkOutLongitude: checkoutLng,
                workingHours: netHours, status,
            },
        });
    });
}

/**
 * Sum of APPROVED PermissionRequest.hours for this employee across a calendar
 * month (1-12, e.g. `month=9` for September). Payroll's per-employee,
 * per-month Salary Pay screen reads this to decide the pay consequence of
 * accumulated permission hours (proportional deduction, or one full day of
 * Loss of Pay once a configured threshold is reached) — see
 * attendance-hr/plan-permission-hours-payroll.md. This replaces the old
 * real-time count-based permission-quota mechanism, which forced a day to
 * Absent+LOP the moment the Nth permission was *approved*, regardless of
 * hours — that double-penalized an employee whenever the permission covered
 * a late-arrival/early-departure (the punch-derived hours were already short,
 * then the quota mechanism zeroed the day out on top of that). Attendance no
 * longer reacts to permission hours in any way; only Payroll does, monthly.
 */
export async function getApprovedPermissionHoursForMonth(
    employeeId: string,
    month: number,
    year: number,
): Promise<number> {
    const monthStartUtc = new Date(Date.UTC(year, month - 1, 1));
    const monthEndExclusiveUtc = new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1));
    const approved = await prisma.permissionRequest.findMany({
        where: { employeeId, status: 'APPROVED', date: { gte: monthStartUtc, lt: monthEndExclusiveUtc } },
        select: { hours: true },
    });
    return approved.reduce((acc, p) => acc + Number(p.hours), 0);
}

/**
 * Returns UTC boundaries for a calendar month in Asia/Kolkata timezone.
 * Used for Fixed Monthly Leave Quota calculation and monthly permission aggregation.
 */
export function getKolkataMonthBounds(input?: Date | { month: number; year: number }): {
    monthStartUtc: Date;
    monthEndExclusiveUtc: Date;
    month: number;
    year: number;
} {
    let month: number;
    let year: number;
    if (input && 'month' in input && 'year' in input) {
        month = input.month;
        year = input.year;
    } else {
        const d = input instanceof Date ? input : new Date();
        const formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', year: 'numeric', month: 'numeric' });
        const parts = formatter.formatToParts(d);
        month = Number(parts.find((p) => p.type === 'month')?.value ?? 1);
        year = Number(parts.find((p) => p.type === 'year')?.value ?? 2026);
    }
    const monthStartUtc = new Date(Date.UTC(year, month - 1, 1));
    const monthEndExclusiveUtc = new Date(Date.UTC(month === 12 ? year + 1 : year, month === 12 ? 0 : month, 1));
    return { monthStartUtc, monthEndExclusiveUtc, month, year };
}

/**
 * Current remaining balance for one employee + leave type — (monthlyQuota
 * openingBalance + carriedForwardDays) minus days already used IN THAT
 * CALENDAR MONTH (FULL_DAY/ABSENT/HALF_DAY Attendance rows tagged with that
 * leaveTypeId within [monthStartUtc, monthEndExclusiveUtc), each weighted 0.5
 * if `isHalfDayLeave` is set on the row, else 1).
 *
 * Implements the Fixed Monthly Quota policy, now with optional carry-forward
 * (see attendance-hr/plan-leave-carry-forward.md):
 *  - Quota resets automatically on the 1st of every month (usedDays in the new month is 0).
 *  - Unused days carry over to the next month only when the leave type has
 *    allowCarryForward on, capped at LeaveType.carryForwardMaxDays — computed
 *    by rolloverLeaveBalancesForNextMonth once that month's payroll is paid,
 *    not by this function.
 *  - Excess days taken in that month convert to Loss of Pay (LOP) for that month.
 */
export async function getRemainingLeaveBalance(
    employeeId: string,
    leaveTypeId: string,
    options?: { date?: Date; month?: number; year?: number } | Date,
    client: Pick<typeof prisma, 'employeeLeaveBalance' | 'attendance'> = prisma,
): Promise<number> {
    const ref = options instanceof Date ? options : (options ? (options.date ?? (options.month && options.year ? { month: options.month, year: options.year } : undefined)) : undefined);
    const { monthStartUtc, monthEndExclusiveUtc, month, year } = getKolkataMonthBounds(ref);

    const [balance, usedRows] = await Promise.all([
        client.employeeLeaveBalance.findUnique({ where: { employeeId_leaveTypeId_month_year: { employeeId, leaveTypeId, month, year } } }),
        client.attendance.findMany({
            where: {
                userId: employeeId,
                leaveTypeId,
                status: { in: ['PRESENT', 'ABSENT', 'HALF_DAY'] },
                date: { gte: monthStartUtc, lt: monthEndExclusiveUtc },
            },
            select: { isHalfDayLeave: true },
        }),
    ]);
    const totalAvailable = balance ? Math.round(Number(balance.openingBalance) + Number(balance.carriedForwardDays)) : 0;
    const usedDays = usedRows.reduce((sum, r) => sum + (r.isHalfDayLeave ? 0.5 : 1), 0);
    return Math.max(0, totalAvailable - usedDays);
}

/**
 * Batched version of getRemainingLeaveBalance for a list of applications.
 * Scopes used days to each application's calendar month.
 * Returns a map keyed by both "employeeId:leaveTypeId:month:year" and "employeeId:leaveTypeId".
 */
export async function getRemainingLeaveBalancesBatch(
    pairs: { employeeId: string; leaveTypeId: string; date?: Date; month?: number; year?: number }[],
): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (pairs.length === 0) return result;

    const employeeIds = Array.from(new Set(pairs.map((p) => p.employeeId)));
    const leaveTypeIds = Array.from(new Set(pairs.map((p) => p.leaveTypeId)));

    // Group pairs by their calendar month bounds
    const monthGroups = new Map<string, { monthStartUtc: Date; monthEndExclusiveUtc: Date; month: number; year: number }>();
    for (const p of pairs) {
        const ref = p.date ? p.date : (p.month && p.year ? { month: p.month, year: p.year } : undefined);
        const bounds = getKolkataMonthBounds(ref);
        const key = `${bounds.year}-${bounds.month}`;
        if (!monthGroups.has(key)) {
            monthGroups.set(key, bounds);
        }
    }

    const monthYearPairs = Array.from(monthGroups.values()).map((b) => ({ month: b.month, year: b.year }));

    const [balances, ...attendancesByMonth] = await Promise.all([
        prisma.employeeLeaveBalance.findMany({
            where: {
                employeeId: { in: employeeIds },
                leaveTypeId: { in: leaveTypeIds },
                OR: monthYearPairs.map((my) => ({ month: my.month, year: my.year })),
            },
            select: { employeeId: true, leaveTypeId: true, month: true, year: true, openingBalance: true, carriedForwardDays: true },
        }),
        ...Array.from(monthGroups.values()).map(async (bounds) => {
            const rows = await prisma.attendance.findMany({
                where: {
                    userId: { in: employeeIds },
                    leaveTypeId: { in: leaveTypeIds },
                    status: { in: ['PRESENT', 'ABSENT', 'HALF_DAY'] },
                    date: { gte: bounds.monthStartUtc, lt: bounds.monthEndExclusiveUtc },
                },
                select: { userId: true, leaveTypeId: true, isHalfDayLeave: true },
            });
            return { monthKey: `${bounds.year}-${bounds.month}`, rows };
        }),
    ]);

    // Keyed by "employeeId:leaveTypeId:year-month" now — balances aren't a single
    // per-employee+type row anymore (see attendance-hr/plan-leave-carry-forward.md).
    const totalAvailableByKey = new Map<string, number>();
    for (const b of balances) totalAvailableByKey.set(`${b.employeeId}:${b.leaveTypeId}:${b.year}-${b.month}`, Math.round(Number(b.openingBalance) + Number(b.carriedForwardDays)));

    // Map: "employeeId:leaveTypeId:year-month" -> usedDays
    const usedByKeyAndMonth = new Map<string, number>();
    for (const group of attendancesByMonth) {
        for (const a of group.rows) {
            const k = `${a.userId}:${a.leaveTypeId}:${group.monthKey}`;
            usedByKeyAndMonth.set(k, (usedByKeyAndMonth.get(k) ?? 0) + (a.isHalfDayLeave ? 0.5 : 1));
        }
    }

    for (const p of pairs) {
        const ref = p.date ? p.date : (p.month && p.year ? { month: p.month, year: p.year } : undefined);
        const bounds = getKolkataMonthBounds(ref);
        const monthKey = `${bounds.year}-${bounds.month}`;
        const totalAvailable = totalAvailableByKey.get(`${p.employeeId}:${p.leaveTypeId}:${monthKey}`) ?? 0;
        const used = usedByKeyAndMonth.get(`${p.employeeId}:${p.leaveTypeId}:${monthKey}`) ?? 0;
        const remaining = Math.max(0, totalAvailable - used);

        // Key by both composite and legacy pair key for full backward compatibility
        result.set(`${p.employeeId}:${p.leaveTypeId}:${bounds.month}:${bounds.year}`, remaining);
        result.set(`${p.employeeId}:${p.leaveTypeId}`, remaining);
    }
    return result;
}

/**
 * The active "Loss of Pay" LeaveType, if one has been configured. Prefers the
 * explicit `isLop` flag (set from Leave Type master); falls back to the old
 * name-matching convention for data created before that flag existed. Used by
 * the permission-quota rule (Working Hours → "Max Permissions per Cycle") and
 * the leave-approve balance-split to stamp days ABSENT + LOP. Returns null
 * (never throws) when no such LeaveType exists yet — callers must treat that
 * as "skip, don't block".
 */
export async function resolveLopLeaveType(
    client: Pick<typeof prisma, 'leaveType'> = prisma,
): Promise<{ id: string; leaveType: string } | null> {
    const flagged = await client.leaveType.findFirst({
        where: { isActive: true, isLop: true },
        select: { id: true, leaveType: true },
    });
    if (flagged) return flagged;

    return client.leaveType.findFirst({
        where: {
            isActive: true,
            OR: [
                { leaveType: { contains: 'LOSS OF PAY', mode: 'insensitive' } },
                { leaveType: { contains: 'LOP', mode: 'insensitive' } },
            ],
        },
        select: { id: true, leaveType: true },
    });
}

/**
 * Rolls this employee's leave balances forward into the month AFTER
 * `paidMonth`/`paidYear` — called from app/api/payroll/salary-pay/route.ts's
 * PATCH action:'pay' once that month's payroll is marked PAID for the
 * employee (this codebase's stand-in for "the month is locked/closed"; there
 * is no separate attendance-lock cron — see
 * attendance-hr/plan-leave-carry-forward.md). Per active, non-LOP leave type:
 *  - skipped entirely if a row already exists for the next month (never
 *    overwrites an admin-entered value for a month that's already set up);
 *  - skipped if no row exists for the just-paid month either — nothing to
 *    repeat or carry from (matches the existing "0 balance until an admin
 *    sets one" behavior; an employee's very first month still needs a manual
 *    Leave Balance screen entry to seed the cycle);
 *  - next month's openingBalance repeats the just-paid month's openingBalance
 *    (no separate "monthly quota" field exists — the admin's last entered
 *    value is what recurs, per the user's explicit choice);
 *  - next month's carriedForwardDays = min(closing remainingBalance of the
 *    just-paid month, LeaveType.carryForwardMaxDays) when allowCarryForward is
 *    true, else 0. "Closing remainingBalance" is computed fresh from
 *    (opening + carried-in) minus actual Attendance usage that month — not
 *    read from the row's own possibly-stale `remainingBalance` column.
 */
export async function rolloverLeaveBalancesForNextMonth(
    client: Prisma.TransactionClient,
    employeeId: string,
    paidMonth: number,
    paidYear: number,
): Promise<void> {
    const nextMonth = paidMonth === 12 ? 1 : paidMonth + 1;
    const nextYear = paidMonth === 12 ? paidYear + 1 : paidYear;

    const leaveTypes = await client.leaveType.findMany({ where: { isActive: true, isLop: false } });
    if (leaveTypes.length === 0) return;
    const leaveTypeIds = leaveTypes.map((lt) => lt.id);

    const [currentRows, nextRows] = await Promise.all([
        client.employeeLeaveBalance.findMany({ where: { employeeId, leaveTypeId: { in: leaveTypeIds }, month: paidMonth, year: paidYear } }),
        client.employeeLeaveBalance.findMany({ where: { employeeId, leaveTypeId: { in: leaveTypeIds }, month: nextMonth, year: nextYear }, select: { leaveTypeId: true } }),
    ]);
    const nextExists = new Set(nextRows.map((r) => r.leaveTypeId));
    const { monthStartUtc, monthEndExclusiveUtc } = getKolkataMonthBounds({ month: paidMonth, year: paidYear });

    for (const lt of leaveTypes) {
        if (nextExists.has(lt.id)) continue;
        const current = currentRows.find((r) => r.leaveTypeId === lt.id);
        if (!current) continue;

        const usedRows = await client.attendance.findMany({
            where: { userId: employeeId, leaveTypeId: lt.id, status: { in: ['PRESENT', 'ABSENT', 'HALF_DAY'] }, date: { gte: monthStartUtc, lt: monthEndExclusiveUtc } },
            select: { isHalfDayLeave: true },
        });
        const used = usedRows.reduce((sum, r) => sum + (r.isHalfDayLeave ? 0.5 : 1), 0);
        const totalAvailable = Number(current.openingBalance) + Number(current.carriedForwardDays);
        const closingRemaining = Math.max(0, totalAvailable - used);

        const nextOpeningBalance = Number(current.openingBalance);
        const carriedForwardDays = lt.allowCarryForward ? Math.min(closingRemaining, Number(lt.carryForwardMaxDays ?? 0)) : 0;
        const nextRemaining = nextOpeningBalance + carriedForwardDays;

        await client.employeeLeaveBalance.create({
            data: {
                employeeId, leaveTypeId: lt.id, month: nextMonth, year: nextYear,
                openingBalance: nextOpeningBalance, carriedForwardDays, remainingBalance: nextRemaining,
            },
        });
    }
}
