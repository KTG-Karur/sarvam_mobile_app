import { Prisma } from '@prisma/client';
import { prisma } from '@/app/lib/db';
import { getKolkataMonthBounds, getApprovedPermissionHoursForMonth } from '@/app/lib/attendance-leave-permission';
import { getWorkingHours } from '@/app/lib/working-hours';
import { getHolidaysForBranch, getWeekConfiguration } from '@/app/lib/attendance-schedule';
import { getKolkataCalendarYmd, getUtcBoundsForBranchCalendarDay } from '@/app/lib/branch-lock';
import { computeUnpaidDays } from './attendance-days';
import { getIncentiveReportData } from '@/app/lib/services/incentive-report.service';
import { PAYROLL_MONTH_DAYS, resolvePercentAmount } from './payroll-grid';

export { PAYROLL_MONTH_DAYS };

/**
 * Payroll's CTC -> Basic/HRA/Gross math, matching the org's Payroll excel
 * sheet formulas exactly (verified against the workbook's own cell formulas):
 *   Basic = CTC * basicPct ; HRA = CTC * hraPct
 *   ActualGross = ROUND(WorkingDays / TotalPaidDays * CTC, 0)
 *   ActualBasic = ROUND(ActualGross * basicPct, 0) ; ActualHRA = ActualGross - ActualBasic
 * ActualHRA is a residual (not its own rounded product) so the two always
 * reconcile exactly to ActualGross — same penny-distribution pattern already
 * used for loan installments in app/lib/staff-loans/application.ts.
 */
export function computeCtcBreakdown(params: {
    monthlyCtc: number;
    basicPercent: number;
    hraPercent: number;
    workingDays: number;
    totalPaidDays: number;
}) {
    const ctc = new Prisma.Decimal(params.monthlyCtc);
    const basicPct = new Prisma.Decimal(params.basicPercent).div(100);
    const hraPct = new Prisma.Decimal(params.hraPercent).div(100);

    const basic = ctc.mul(basicPct).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
    const hra = ctc.mul(hraPct).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

    const proration = params.totalPaidDays > 0
        ? new Prisma.Decimal(params.workingDays).div(params.totalPaidDays)
        : new Prisma.Decimal(0);
    const actualGross = ctc.mul(proration).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
    const actualBasic = actualGross.mul(basicPct).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
    const actualHra = actualGross.minus(actualBasic);

    return {
        basic: basic.toNumber(),
        hra: hra.toNumber(),
        actualGross: actualGross.toNumber(),
        actualBasic: actualBasic.toNumber(),
        actualHra: actualHra.toNumber(),
    };
}

export function yearCtcFromMonthly(monthlyCtc: number): number {
    return new Prisma.Decimal(monthlyCtc).mul(12).toNumber();
}

/**
 * Inverse of computeCtcBreakdown's proration step — reconstructs the full
 * (unprorated) Basic/HRA for a historical payslip from its already-stored
 * Actual Basic/Actual Gross and the stamped monthlyCtc, without re-looking-up
 * the employee's current Designation % (which may have changed since).
 * Since ActualBasic = ActualGross * basicPct exactly (by construction),
 * basicPct = ActualBasic / ActualGross reconstructs the same ratio; HRA is
 * the residual (monthlyCtc - Basic) for exact reconciliation. Used by the
 * Payroll Report, which shows both the full and LOP-prorated figures per
 * the org's Payroll excel sheet format.
 */
export function deriveFullBasicHra(params: { monthlyCtc: number; actualBasic: number; actualGross: number }): { basic: number; hra: number } {
    if (params.actualGross <= 0) return { basic: 0, hra: 0 };
    const ctc = new Prisma.Decimal(params.monthlyCtc);
    const ratio = new Prisma.Decimal(params.actualBasic).div(params.actualGross);
    const basic = ctc.mul(ratio).toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
    const hra = ctc.minus(basic);
    return { basic: basic.toNumber(), hra: hra.toNumber() };
}

/**
 * Resolves a percentage-based deduction amount (PF/ESI, or any other
 * component an admin has configured this way on Salary Details) — an
 * employee's own percentOverride wins if set, else the component's
 * org-wide defaultPercent; multiplied against Actual Basic (statutory PF
 * pattern) or Actual Gross (statutory ESI pattern) per the component's
 * configured basis, rounded to whole rupees (the org's sheet carries
 * whole-rupee PF/ESI). Returns null when the component isn't percentage-based
 * at all (no defaultPercent/basis configured) — callers fall back to the
 * flat manually-entered EmployeeSalaryMaster.amount in that case, so
 * every other deduction (Other Deductions, Arrear, Staff Advance, ...)
 * behaves exactly as before.
 *
 * When the component has a maxAmount, the computed amount is capped at it
 * (e.g. PF at ₹1,800); no maxAmount = no cap. When it has a
 * ctcEligibilityLimit and the employee's Month CTC Pay is above it, the
 * amount is 0 (e.g. ESI only up to ₹21,000 CTC) — checked against the full
 * monthlyCtc, not the LOP-prorated gross, matching the org's Payroll sheet.
 */
export function resolvePercentDeduction(params: {
    defaultPercent: number | null;
    percentBasis: 'BASIC' | 'GROSS' | null;
    percentOverride: number | null;
    actualBasic: number;
    actualGross: number;
    maxAmount?: number | null;
    monthlyCtc?: number;
    ctcEligibilityLimit?: number | null;
}): number | null {
    if (!params.percentBasis) return null;
    const pct = params.percentOverride ?? params.defaultPercent;
    if (pct === null || pct === undefined) return null;
    return resolvePercentAmount({
        percent: pct,
        basis: params.percentBasis,
        actualBasic: params.actualBasic,
        actualGross: params.actualGross,
        monthlyCtc: params.monthlyCtc ?? 0,
        maxAmount: params.maxAmount,
        ctcEligibilityLimit: params.ctcEligibilityLimit,
    });
}

/**
 * Total Paid Days = PAYROLL_MONTH_DAYS (fixed 30 for every month, matching the
 * org's Payroll excel sheet — never the 28-31 calendar length); LOP = the
 * employee's unpaid days for the month from Attendance — absent days, half-day
 * shortfalls, Loss-of-Pay leave and days outside the joining/exit dates, by the
 * same rules as the Attendance page's Monthly Calendar (see attendance-days.ts).
 * Working Days = Total Paid Days - LOP. Replaces manual Total Paid Days/LOP entry
 * from the org's Payroll excel sheet with a live Attendance-derived figure.
 */
export async function getAttendanceDerivedPaidDays(employeeId: string, month: number, year: number) {
    const totalPaidDays = PAYROLL_MONTH_DAYS;

    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const { dayStartUtc: rangeStartUtc } = getUtcBoundsForBranchCalendarDay(new Date(Date.UTC(year, month - 1, 1, 12)), 'Asia/Kolkata');
    const { dayEndUtc: rangeEndUtc } = getUtcBoundsForBranchCalendarDay(new Date(Date.UTC(year, month - 1, daysInMonth, 12)), 'Asia/Kolkata');

    const [employee, attendanceRows, approvedLeaves] = await Promise.all([
        prisma.user.findUnique({ where: { id: employeeId }, select: { dateOfJoining: true, dateOfExit: true, branchId: true } }),
        prisma.attendance.findMany({
            where: { userId: employeeId, date: { gte: rangeStartUtc, lte: rangeEndUtc } },
            select: {
                date: true, status: true, isHoliday: true, isHalfDayLeave: true, lopLocked: true, leaveTypeId: true,
                leaveType: { select: { isLop: true } },
            },
        }),
        prisma.leaveApplication.findMany({
            where: { employeeId, status: 'APPROVED', fromDate: { lte: rangeEndUtc }, toDate: { gte: rangeStartUtc } },
            select: { fromDate: true, toDate: true, isHalfDay: true, leaveType: { select: { isLop: true } } },
        }),
    ]);

    // The employee's own branch decides which weeks-off and holidays count (per-branch tables).
    const branchId = employee?.branchId ?? '';
    const [schedule, holidays] = await Promise.all([
        getWeekConfiguration(branchId),
        branchId ? getHolidaysForBranch(branchId, { from: rangeStartUtc, to: rangeEndUtc }) : Promise.resolve([]),
    ]);
    const { lopDays, breakdown } = computeUnpaidDays({
        month,
        year,
        todayYmd: getKolkataCalendarYmd(new Date()),
        rows: attendanceRows.map((r) => ({
            dateYmd: getKolkataCalendarYmd(r.date),
            status: r.status,
            isHoliday: r.isHoliday,
            isHalfDayLeave: r.isHalfDayLeave,
            lopLocked: r.lopLocked,
            leaveTypeId: r.leaveTypeId,
            leaveIsLop: r.leaveType?.isLop ?? false,
        })),
        leaves: approvedLeaves.map((l) => ({
            fromYmd: getKolkataCalendarYmd(l.fromDate),
            toYmd: getKolkataCalendarYmd(l.toDate),
            isHalfDay: l.isHalfDay,
            isLop: l.leaveType?.isLop ?? false,
        })),
        schedule,
        dateOverrides: holidays.map((h) => ({ date: getKolkataCalendarYmd(h.date), isWorkingDay: h.isWorkingDay })),
        joinYmd: employee?.dateOfJoining ? getKolkataCalendarYmd(employee.dateOfJoining) : null,
        exitYmd: employee?.dateOfExit ? getKolkataCalendarYmd(employee.dateOfExit) : null,
    });
    const workingDays = Math.max(0, totalPaidDays - lopDays);

    return { totalPaidDays, lopDays, workingDays, lopBreakdown: breakdown };
}

/**
 * Payroll must consume the existing incentive calculation, not duplicate it —
 * resolves this employee's already-computed finalIncentive for the period
 * (same DCB/loan-performance engine that drives the Incentive Report) instead
 * of a separate employee-incentive slab system. Only meaningful for FDOs, who
 * are the only role this engine scores; any other role's Incentives line
 * stays manual (EmployeeSalaryMaster default).
 */
export async function resolveComputedIncentive(employeeId: string, role: string, month: number, year: number): Promise<number | null> {
    if (role !== 'FDO') return null;
    try {
        const daysInMonth = new Date(year, month, 0).getDate();
        const pad = (n: number) => String(n).padStart(2, '0');
        const result = await getIncentiveReportData({
            fromDate: `${year}-${pad(month)}-01`,
            toDate: `${year}-${pad(month)}-${daysInMonth}`,
            scopedBranchIds: null,
            fdoId: employeeId,
            page: 1,
            pageSize: 1,
        });
        return result.data[0]?.finalIncentive ?? 0;
    } catch (error) {
        console.error('[Payroll] Failed to resolve computed incentive, falling back to manual entry:', error);
        return null;
    }
}

/**
 * Computed incentive for every active FDO of the given branches, one incentive-engine run PER BRANCH (all of that
 * branch's FDOs at once) instead of one run per FDO.
 * The engine loads the branch's slabs, loan book and collections per call, so per-FDO lookups repeated that heavy load
 * for every FDO of the same branch and made a company-wide payroll preview take minutes; one run per branch gives the
 * same numbers with far fewer runs, and a single company-wide run would load every loan in the system at once.
 * `coveredBranchIds` lists the branches whose run succeeded; the caller falls back to the per-employee lookup (which has
 * its own fallback) for FDOs of any other branch.
 */
export async function resolveComputedIncentivesByBranch(
    month: number,
    year: number,
    branchIds: readonly string[],
    concurrency = 3,
): Promise<{ incentives: Map<string, number>; coveredBranchIds: Set<string> }> {
    const daysInMonth = new Date(year, month, 0).getDate();
    const pad = (n: number) => String(n).padStart(2, '0');
    const incentives = new Map<string, number>();
    const coveredBranchIds = new Set<string>();
    const queue = Array.from(new Set(branchIds));

    const worker = async () => {
        while (queue.length > 0) {
            const branchId = queue.shift()!;
            try {
                const result = await getIncentiveReportData({
                    fromDate: `${year}-${pad(month)}-01`,
                    toDate: `${year}-${pad(month)}-${daysInMonth}`,
                    scopedBranchIds: null,
                    branchId,
                    page: 1,
                    pageSize: 100000,
                });
                for (const row of result.data) incentives.set(row.fdoId, row.finalIncentive);
                coveredBranchIds.add(branchId);
            } catch (error) {
                console.error(`[Payroll] Branch incentive run failed for ${branchId}, falling back to per-employee lookup:`, error);
            }
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, worker));
    return { incentives, coveredBranchIds };
}

/**
 * Permission-hours-to-deduction auto-fill — see
 * attendance-hr/plan-permission-hours-payroll.md. Attendance no longer reacts
 * to approved permission hours at all; this is the one place their pay
 * consequence gets computed, same "auto-fill, admin can override before
 * submit" pattern used for the FDO incentive component.
 *
 * Daily rate uses the common 26-working-days/month convention (no per-branch
 * working-day calendar exists to derive this more precisely); hourly rate
 * divides that by the configured full-day hours. Below the configured
 * threshold, the deduction is proportional (hours × hourly rate); at or above
 * it, it becomes one full day's pay instead.
 */
const PAYROLL_DAYS_PER_MONTH = 26;

export async function resolvePermissionDeduction(employeeId: string, month: number, year: number): Promise<number> {
    const [permissionHours, monthlyEarnings] = await Promise.all([
        getApprovedPermissionHoursForMonth(employeeId, month, year),
        prisma.employeeSalaryMaster.findMany({
            where: { employeeId, isActive: true, salaryComponent: { type: 'EARNINGS' } },
            select: { amount: true },
        }),
    ]);
    if (permissionHours <= 0) return 0;

    const monthlyGross = monthlyEarnings.reduce((sum, m) => sum + Number(m.amount), 0);
    const dailyRate = monthlyGross / PAYROLL_DAYS_PER_MONTH;
    const { fullDayHours, permissionHoursLopThreshold } = await getWorkingHours();

    if (permissionHours >= permissionHoursLopThreshold) {
        return Math.round(dailyRate * 100) / 100;
    }
    const hourlyRate = fullDayHours > 0 ? dailyRate / fullDayHours : 0;
    return Math.round(permissionHours * hourlyRate * 100) / 100;
}
