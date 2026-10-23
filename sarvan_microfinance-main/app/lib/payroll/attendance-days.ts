/**
 * Payroll's unpaid-days (LOP) count, derived from the same Attendance data
 * and the same day rules the Attendance page's Monthly Calendar
 * (app/api/hr/attendance/calendar/route.ts) uses — so what HR sees on
 * /dashboard/hr/attendance is what Payroll deducts:
 *
 *   PRESENT / FULL_DAY ........................ paid
 *   HOLIDAY (or isHoliday) / weekly off / date-override holiday ... paid
 *   ABSENT with a leave type or an approved leave ... paid, UNLESS the leave
 *       type is the Loss-of-Pay type (isLop) or the row is lopLocked
 *   ABSENT with no leave (past working day, or no record at all) ... 1 unpaid day
 *   HALF_DAY ................................. 0.5 unpaid, unless it is a
 *       half-day leave (isHalfDayLeave) — then paid, unless that leave is LOP
 *   approved half-day leave with no record ... 0.5 leave (paid unless LOP) + 0.5 unpaid
 *   future days (after today) ................ not counted (still upcoming)
 *   before the joining date / after the exit date ... unpaid (not employed)
 *
 * Pure (no I/O) so it is unit-testable; the DB wrapper is
 * getAttendanceDerivedPaidDays in calculation.ts.
 */

export type PayrollAttendanceRow = {
    dateYmd: string;
    status: string;
    isHoliday: boolean;
    isHalfDayLeave: boolean;
    lopLocked: boolean;
    leaveTypeId: string | null;
    /** The row's leave type is the Loss-of-Pay type. */
    leaveIsLop: boolean;
};

export type PayrollApprovedLeave = {
    fromYmd: string;
    toYmd: string;
    isHalfDay: boolean;
    isLop: boolean;
};

export type WeeklySchedule = {
    sunday: boolean; monday: boolean; tuesday: boolean; wednesday: boolean;
    thursday: boolean; friday: boolean; saturday: boolean;
};

export type UnpaidDaysBreakdown = {
    /** Full days absent with no leave cover (incl. no record on a working day). */
    absentDays: number;
    /** Half-days worked without leave cover (the missing 0.5 each). */
    halfDayShortfall: number;
    /** Days on Loss-of-Pay leave / permission-quota LOP. */
    lopLeaveDays: number;
    /** Days before joining / after exit. */
    notEmployedDays: number;
};

export type UnpaidDaysResult = { lopDays: number; breakdown: UnpaidDaysBreakdown };

const WEEKDAY_KEYS: (keyof WeeklySchedule)[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const PAID_STATUSES = new Set(['PRESENT', 'FULL_DAY', 'PRESET']);

export function computeUnpaidDays(params: {
    month: number;
    year: number;
    /** Today's date in IST (YYYY-MM-DD) — days after it are still upcoming. */
    todayYmd: string;
    rows: PayrollAttendanceRow[];
    leaves: PayrollApprovedLeave[];
    schedule: WeeklySchedule;
    dateOverrides: { date: string; isWorkingDay: boolean }[];
    /** Employment window (IST YYYY-MM-DD); either bound may be absent. */
    joinYmd?: string | null;
    exitYmd?: string | null;
}): UnpaidDaysResult {
    const { month, year, todayYmd } = params;
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const rowByDay = new Map(params.rows.map((r) => [r.dateYmd, r]));
    const overrideByDay = new Map(params.dateOverrides.map((o) => [o.date, o.isWorkingDay]));
    const pad = (n: number) => String(n).padStart(2, '0');

    const breakdown: UnpaidDaysBreakdown = { absentDays: 0, halfDayShortfall: 0, lopLeaveDays: 0, notEmployedDays: 0 };

    for (let d = 1; d <= daysInMonth; d++) {
        const ymd = `${year}-${pad(month)}-${pad(d)}`;

        if ((params.joinYmd && ymd < params.joinYmd) || (params.exitYmd && ymd > params.exitYmd)) {
            breakdown.notEmployedDays += 1;
            continue;
        }

        const row = rowByDay.get(ymd);
        const leave = params.leaves.find((l) => ymd >= l.fromYmd && ymd <= l.toYmd);

        if (row) {
            if (row.isHoliday || row.status === 'HOLIDAY' || PAID_STATUSES.has(row.status)) continue;
            if (row.status === 'HALF_DAY') {
                if (row.isHalfDayLeave) {
                    if (row.leaveIsLop) breakdown.lopLeaveDays += 0.5;
                } else {
                    breakdown.halfDayShortfall += 0.5;
                }
                continue;
            }
            // ABSENT (or any other non-paid status)
            if (row.lopLocked || row.leaveIsLop) breakdown.lopLeaveDays += 1;
            else if (row.leaveTypeId || leave) continue; // paid leave
            else breakdown.absentDays += 1;
            continue;
        }

        if (leave) {
            const weight = leave.isHalfDay ? 0.5 : 1;
            if (leave.isLop) breakdown.lopLeaveDays += weight;
            // Half-day leave with no punch record: the other half is unaccounted for.
            if (leave.isHalfDay) breakdown.halfDayShortfall += 0.5;
            continue;
        }

        if (ymd > todayYmd) continue; // upcoming

        const override = overrideByDay.get(ymd);
        const weekday = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
        const isWorkingDay = override ?? params.schedule[WEEKDAY_KEYS[weekday]] ?? true;
        if (!isWorkingDay) continue; // weekly off / declared holiday

        breakdown.absentDays += 1;
    }

    const lopDays = breakdown.absentDays + breakdown.halfDayShortfall + breakdown.lopLeaveDays + breakdown.notEmployedDays;
    return { lopDays, breakdown };
}

/** Short human note for a LOP figure, e.g. "2 absent · 1 half-day short · 1 LOP leave". */
export function describeUnpaidDays(b: UnpaidDaysBreakdown | undefined): string {
    if (!b) return '';
    const parts: string[] = [];
    if (b.absentDays) parts.push(`${b.absentDays} absent`);
    if (b.halfDayShortfall) parts.push(`${b.halfDayShortfall} half-day short`);
    if (b.lopLeaveDays) parts.push(`${b.lopLeaveDays} LOP leave`);
    if (b.notEmployedDays) parts.push(`${b.notEmployedDays} not employed`);
    return parts.length ? `From attendance: ${parts.join(' · ')}` : 'From attendance: no unpaid days';
}
