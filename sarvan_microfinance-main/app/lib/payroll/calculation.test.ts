import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
    attendance: { findMany: vi.fn() },
    leaveApplication: { findMany: vi.fn() },
    user: { findUnique: vi.fn() },
}));
vi.mock('@/app/lib/db', () => ({ prisma: db }));
vi.mock('@/app/lib/attendance-schedule', () => ({
    getWeekConfiguration: async () => ({ sunday: false, monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: true }),
    getHolidaysForBranch: async () => [],
}));

import { computeCtcBreakdown, yearCtcFromMonthly, getAttendanceDerivedPaidDays, resolvePercentDeduction, deriveFullBasicHra } from './calculation';

describe('computeCtcBreakdown', () => {
    it('matches the org payroll sheet formulas for a full-attendance month (no LOP)', () => {
        // Verified against the actual workbook: 85000 CTC, 70/30 split, 30/30 days.
        const result = computeCtcBreakdown({ monthlyCtc: 85000, basicPercent: 70, hraPercent: 30, workingDays: 30, totalPaidDays: 30 });
        expect(result.basic).toBe(59500);
        expect(result.hra).toBe(25500);
        expect(result.actualGross).toBe(85000);
        expect(result.actualBasic).toBe(59500);
        expect(result.actualHra).toBe(25500);
    });

    it('prorates Actual Gross/Basic/HRA by working days, matching the workbook example (LOP=1, 29/30 days)', () => {
        // Workbook: 10500 CTC, LOP=1 -> ActualGross 10150, ActualBasic 7105, ActualHRA 3045.
        const result = computeCtcBreakdown({ monthlyCtc: 10500, basicPercent: 70, hraPercent: 30, workingDays: 29, totalPaidDays: 30 });
        expect(result.actualGross).toBe(10150);
        expect(result.actualBasic).toBe(7105);
        expect(result.actualHra).toBe(3045);
    });

    it('always reconciles ActualBasic + ActualHRA to exactly ActualGross, even with rounding-prone percentages', () => {
        const result = computeCtcBreakdown({ monthlyCtc: 11550, basicPercent: 70, hraPercent: 30, workingDays: 27, totalPaidDays: 30 });
        expect(result.actualBasic + result.actualHra).toBe(result.actualGross);
    });

    it('produces zero actuals when totalPaidDays is zero, without dividing by zero', () => {
        const result = computeCtcBreakdown({ monthlyCtc: 50000, basicPercent: 70, hraPercent: 30, workingDays: 0, totalPaidDays: 0 });
        expect(result.actualGross).toBe(0);
        expect(result.actualBasic).toBe(0);
        expect(result.actualHra).toBe(0);
    });

    it('supports a non-70/30 designation split', () => {
        const result = computeCtcBreakdown({ monthlyCtc: 100000, basicPercent: 60, hraPercent: 40, workingDays: 30, totalPaidDays: 30 });
        expect(result.basic).toBe(60000);
        expect(result.hra).toBe(40000);
        expect(result.actualBasic + result.actualHra).toBe(result.actualGross);
    });
});

describe('yearCtcFromMonthly', () => {
    it('multiplies by 12', () => {
        expect(yearCtcFromMonthly(85000)).toBe(1020000);
        expect(yearCtcFromMonthly(0)).toBe(0);
    });
});

describe('getAttendanceDerivedPaidDays (attendance-driven LOP)', () => {
    // September 2026: 30 days, Sundays (6, 13, 20, 27) are the weekly off.
    const istDay = (d: number) => new Date(`2026-09-${String(d).padStart(2, '0')}T00:00:00+05:30`);
    const row = (d: number, over: Record<string, unknown> = {}) => ({
        date: istDay(d), status: 'PRESENT', isHoliday: false, isHalfDayLeave: false, lopLocked: false, leaveTypeId: null,
        leaveType: null, ...over,
    });
    const fullMonthPresent = () => Array.from({ length: 30 }, (_, i) => i + 1).map((d) => row(d));

    beforeEach(() => {
        vi.resetAllMocks();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-10-05T10:00:00+05:30')); // September is fully in the past
        db.user.findUnique.mockResolvedValue({ dateOfJoining: new Date('2024-01-01T00:00:00+05:30'), dateOfExit: null });
        db.leaveApplication.findMany.mockResolvedValue([]);
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('full attendance: LOP 0, Working Days 30', async () => {
        db.attendance.findMany.mockResolvedValue(fullMonthPresent());
        const result = await getAttendanceDerivedPaidDays('emp1', 9, 2026);
        expect(result).toMatchObject({ totalPaidDays: 30, lopDays: 0, workingDays: 30 });
    });

    it('counts ABSENT days, a LOP-type leave day and a half-day shortfall from Attendance', async () => {
        const rows = fullMonthPresent();
        rows[2] = row(3, { status: 'ABSENT' });                                            // absent, no leave -> 1
        rows[3] = row(4, { status: 'ABSENT', leaveTypeId: 'lop', leaveType: { isLop: true } }); // LOP leave -> 1
        rows[4] = row(5, { status: 'ABSENT', leaveTypeId: 'cl', leaveType: { isLop: false } }); // paid leave -> 0
        rows[6] = row(7, { status: 'HALF_DAY' });                                          // half-day, no leave -> 0.5
        db.attendance.findMany.mockResolvedValue(rows);
        const result = await getAttendanceDerivedPaidDays('emp1', 9, 2026);
        expect(result.lopDays).toBe(2.5);
        expect(result.workingDays).toBe(27.5);
        expect(result.lopBreakdown).toEqual({ absentDays: 1, halfDayShortfall: 0.5, lopLeaveDays: 1, notEmployedDays: 0 });
    });

    it('a working day with no attendance record is absent; weekly-off Sundays are paid', async () => {
        db.attendance.findMany.mockResolvedValue([]);
        const result = await getAttendanceDerivedPaidDays('emp1', 9, 2026);
        expect(result.lopDays).toBe(26); // 30 days - 4 Sundays
        expect(result.workingDays).toBe(4);
    });

    it('days before the joining date are unpaid', async () => {
        db.user.findUnique.mockResolvedValue({ dateOfJoining: istDay(11), dateOfExit: null });
        db.attendance.findMany.mockResolvedValue(fullMonthPresent());
        const result = await getAttendanceDerivedPaidDays('emp1', 9, 2026);
        expect(result.lopBreakdown.notEmployedDays).toBe(10); // Sep 1-10
        expect(result.workingDays).toBe(20);
    });

    it('always uses a fixed 30-day payroll month, never the 31-day calendar length', async () => {
        db.attendance.findMany.mockResolvedValue([]);
        const result = await getAttendanceDerivedPaidDays('emp1', 1, 2026); // January 2026 has 31 days
        expect(result.totalPaidDays).toBe(30);
    });

    it('never returns negative working days', async () => {
        db.attendance.findMany.mockResolvedValue([]);
        db.user.findUnique.mockResolvedValue({ dateOfJoining: new Date('2027-01-01T00:00:00+05:30'), dateOfExit: null });
        const result = await getAttendanceDerivedPaidDays('emp1', 9, 2026);
        expect(result.workingDays).toBe(0);
    });
});

describe('resolvePercentDeduction', () => {
    it('computes PF-style: % of Actual Basic', () => {
        const amount = resolvePercentDeduction({
            defaultPercent: 12, percentBasis: 'BASIC', percentOverride: null,
            actualBasic: 20000, actualGross: 28000,
        });
        expect(amount).toBe(2400);
    });

    it('computes ESI-style: % of Actual Gross', () => {
        const amount = resolvePercentDeduction({
            defaultPercent: 0.75, percentBasis: 'GROSS', percentOverride: null,
            actualBasic: 20000, actualGross: 28000,
        });
        expect(amount).toBe(210);
    });

    it('an employee-level percentOverride wins over the component default', () => {
        const amount = resolvePercentDeduction({
            defaultPercent: 12, percentBasis: 'BASIC', percentOverride: 0,
            actualBasic: 20000, actualGross: 28000,
        });
        expect(amount).toBe(0); // exempt employee, not the 12% default
    });

    it('returns null (not percentage-based) when no basis is configured, regardless of any stray percent value', () => {
        expect(resolvePercentDeduction({ defaultPercent: 12, percentBasis: null, percentOverride: null, actualBasic: 20000, actualGross: 28000 })).toBeNull();
    });

    it('returns null when neither a default nor an override percent is set', () => {
        expect(resolvePercentDeduction({ defaultPercent: null, percentBasis: 'BASIC', percentOverride: null, actualBasic: 20000, actualGross: 28000 })).toBeNull();
    });

    it('rounds to 2 decimal places (13333 * 0.75% = 99.9975 -> 100.00)', () => {
        const amount = resolvePercentDeduction({
            defaultPercent: 0.75, percentBasis: 'GROSS', percentOverride: null,
            actualBasic: 10000, actualGross: 13333,
        });
        expect(amount).toBe(100);
    });

    it('caps the computed amount at maxAmount (PF 12% of 20000 = 2400 -> capped at 1800)', () => {
        const amount = resolvePercentDeduction({
            defaultPercent: 12, percentBasis: 'BASIC', percentOverride: null,
            actualBasic: 20000, actualGross: 28000, maxAmount: 1800,
        });
        expect(amount).toBe(1800);
    });

    it('does not touch the amount when it is already below maxAmount', () => {
        const amount = resolvePercentDeduction({
            defaultPercent: 12, percentBasis: 'BASIC', percentOverride: null,
            actualBasic: 10000, actualGross: 14000, maxAmount: 1800,
        });
        expect(amount).toBe(1200);
    });

    it('applies no cap when maxAmount is null/undefined', () => {
        const base = { defaultPercent: 12, percentBasis: 'BASIC' as const, percentOverride: null, actualBasic: 20000, actualGross: 28000 };
        expect(resolvePercentDeduction({ ...base, maxAmount: null })).toBe(2400);
        expect(resolvePercentDeduction(base)).toBe(2400);
    });

    it('caps an employee percentOverride amount too', () => {
        const amount = resolvePercentDeduction({
            defaultPercent: 12, percentBasis: 'BASIC', percentOverride: 15,
            actualBasic: 20000, actualGross: 28000, maxAmount: 1800,
        });
        expect(amount).toBe(1800);
    });
});

describe('deriveFullBasicHra', () => {
    // Verified against the actual "Payroll" excel sheet rows — reconstructs
    // the full Basic/HRA from a payslip's already-stored Actual figures.
    it('matches the excel exactly for a full-attendance row (no LOP)', () => {
        // Row: Anbalagan M — CTC 85000, ActualBasic 59500, ActualGross 85000 -> Basic 59500, HRA 25500.
        const result = deriveFullBasicHra({ monthlyCtc: 85000, actualBasic: 59500, actualGross: 85000 });
        expect(result.basic).toBe(59500);
        expect(result.hra).toBe(25500);
    });

    it('matches the excel exactly for an LOP-prorated row', () => {
        // Row: Priyadharshini Murugan — CTC 10500, LOP=1, ActualBasic 7105, ActualGross 10150 -> Basic 7350, HRA 3150.
        const result = deriveFullBasicHra({ monthlyCtc: 10500, actualBasic: 7105, actualGross: 10150 });
        expect(result.basic).toBe(7350);
        expect(result.hra).toBe(3150);
    });

    it('round-trips exactly with computeCtcBreakdown for an arbitrary split and attendance', () => {
        const forward = computeCtcBreakdown({ monthlyCtc: 33000, basicPercent: 60, hraPercent: 40, workingDays: 27, totalPaidDays: 30 });
        const back = deriveFullBasicHra({ monthlyCtc: 33000, actualBasic: forward.actualBasic, actualGross: forward.actualGross });
        expect(back.basic).toBe(Math.round(33000 * 0.6));
        expect(back.hra).toBe(33000 - back.basic);
    });

    it('returns zero for both when Actual Gross is zero (e.g. a fully LOP month), no division by zero', () => {
        const result = deriveFullBasicHra({ monthlyCtc: 20000, actualBasic: 0, actualGross: 0 });
        expect(result).toEqual({ basic: 0, hra: 0 });
    });

    it('Basic + HRA always reconciles exactly to the full monthlyCtc', () => {
        const result = deriveFullBasicHra({ monthlyCtc: 11000, actualBasic: 6930, actualGross: 9900 });
        expect(result.basic + result.hra).toBe(11000);
    });
});
