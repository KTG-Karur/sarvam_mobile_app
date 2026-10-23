import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { requirePermission, isUserContext } from '@/app/lib/permissions/guards';
import { getKolkataCalendarYmd, getUtcBoundsForBranchCalendarDay } from '@/app/lib/branch-lock';
import { computeTravelledKm, type TrackingPing } from '@/app/lib/hr-tracking';
import { resolveDefaultShiftConfig } from '@/app/lib/employee-shift';
import { getKolkataMonthBounds } from '@/app/lib/attendance-leave-permission';
import { computeRouteSimilarity, filterNearPoint } from '@/app/lib/route-similarity';
import { getEmployeeDayRoutePoints } from '@/app/lib/route-similarity-data';
import { deriveFullBasicHra } from '@/app/lib/payroll/calculation';
import { toDisplayDate } from '@/app/lib/date-format';
import { getPermittedBranchIdsForContext } from '@/app/lib/permissions/branch-scope';

export async function OPTIONS() {
    return handleCorsPreflight();
}

type ReportRows = { headers: string[]; rows: (string | number)[][]; totalCount: number };
type ReportParams = { fromDate: string | null; toDate: string | null; branchIds: string[] | null; employeeId: string | null; shiftId?: string | null; role?: string | null; type?: string | null; status?: string | null; month?: number | null; year?: number | null };

const fmtDate = (d: Date | null) => (d ? toDisplayDate(d) : '');
const rangeDates = (p: ReportParams) => {
    const from = p.fromDate ? getUtcBoundsForBranchCalendarDay(new Date(p.fromDate)).dayStartUtc : undefined;
    const to = p.toDate ? getUtcBoundsForBranchCalendarDay(new Date(p.toDate)).dayEndUtc : undefined;
    return { from, to };
};
/** Prisma date filter from an optional From and/or To — each bound applies on its own. */
const dateBounds = (from?: Date, to?: Date) => (from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : undefined);
/** Whole-number days for display; keeps a half-day as 0.5 instead of rounding it up to 1. */
const fmtDays = (n: unknown) => Math.round(Number(n) * 100) / 100;

/**
 * HR Reports — genuinely-new report types not already covered by the app-wide
 * report-registry.ts (which already has Employee Attendance Summary/Detailed,
 * Payslip and Incentive Report — those stay linked from the HR Reports Hub
 * instead of being rebuilt here). One dynamic [slug] route + small internal
 * dispatch table, rather than 13 near-identical route.ts files.
 */
const REPORTS: Record<string, { name: string; fetch: (p: ReportParams) => Promise<ReportRows> }> = {
    'employee-master': {
        name: 'Employee Master Report',
        fetch: async (p) => {
            const employees = await prisma.user.findMany({
                where: {
                    ...(p.branchIds ? { branchId: { in: p.branchIds } } : {}),
                    ...(p.employeeId ? { id: p.employeeId } : {}),
                    // Default stays "active only"; the Status filter can widen to inactive / all.
                    ...(p.status === 'inactive' ? { isActive: false } : p.status === 'everyone' ? {} : { isActive: true }),
                },
                select: {
                    employeeId: true, firstName: true, lastName: true, mobileNumber: true, dateOfJoining: true,
                    department: { select: { name: true } }, designation: { select: { name: true } }, branch: { select: { name: true } },
                },
                orderBy: { firstName: 'asc' },
            });
            return {
                headers: ['Employee ID', 'Name', 'Department', 'Designation', 'Branch', 'Mobile', 'Date of Joining'],
                rows: employees.map((e) => [e.employeeId ?? '', `${e.firstName} ${e.lastName}`, e.department?.name ?? '', e.designation?.name ?? '', e.branch?.name ?? '', e.mobileNumber ?? '', fmtDate(e.dateOfJoining)]),
                totalCount: employees.length,
            };
        },
    },
    joining: {
        name: 'Joining Report',
        fetch: async (p) => {
            const { from, to } = rangeDates(p);
            const employees = await prisma.user.findMany({
                where: { ...(p.branchIds ? { branchId: { in: p.branchIds } } : {}), ...(dateBounds(from, to) ? { dateOfJoining: dateBounds(from, to) } : {}) },
                select: { employeeId: true, firstName: true, lastName: true, dateOfJoining: true, department: { select: { name: true } }, designation: { select: { name: true } }, branch: { select: { name: true } } },
                orderBy: { dateOfJoining: 'asc' },
            });
            return {
                headers: ['Employee ID', 'Name', 'Department', 'Designation', 'Branch', 'Date of Joining'],
                rows: employees.map((e) => [e.employeeId ?? '', `${e.firstName} ${e.lastName}`, e.department?.name ?? '', e.designation?.name ?? '', e.branch?.name ?? '', fmtDate(e.dateOfJoining)]),
                totalCount: employees.length,
            };
        },
    },
    exit: {
        name: 'Exit Report',
        fetch: async (p) => {
            const { from, to } = rangeDates(p);
            const exits = await prisma.employeeExitRequest.findMany({
                where: { status: 'COMPLETED', employee: p.branchIds ? { branchId: { in: p.branchIds } } : {}, ...(dateBounds(from, to) ? { lastWorkingDate: dateBounds(from, to) } : {}) },
                include: { employee: { select: { employeeId: true, firstName: true, lastName: true, branch: { select: { name: true } } } } },
                orderBy: { lastWorkingDate: 'desc' },
            });
            return {
                headers: ['Employee ID', 'Name', 'Branch', 'Exit Type', 'Last Working Date'],
                rows: exits.map((e) => [e.employee.employeeId ?? '', `${e.employee.firstName} ${e.employee.lastName}`, e.employee.branch?.name ?? '', e.exitType, fmtDate(e.lastWorkingDate)]),
                totalCount: exits.length,
            };
        },
    },
    transfer: {
        name: 'Transfer Report',
        fetch: async (p) => {
            const { from, to } = rangeDates(p);
            const transfers = await prisma.employeeTransfer.findMany({
                where: { employee: p.branchIds ? { branchId: { in: p.branchIds } } : {}, ...(dateBounds(from, to) ? { effectiveDate: dateBounds(from, to) } : {}) },
                include: {
                    employee: { select: { employeeId: true, firstName: true, lastName: true } },
                    fromBranch: { select: { name: true } }, toBranch: { select: { name: true } },
                },
                orderBy: { effectiveDate: 'desc' },
            });
            return {
                headers: ['Employee ID', 'Name', 'Type', 'From Branch', 'To Branch', 'Effective Date', 'Status'],
                rows: transfers.map((t) => [t.employee.employeeId ?? '', `${t.employee.firstName} ${t.employee.lastName}`, t.transferType, t.fromBranch?.name ?? '', t.toBranch?.name ?? '', fmtDate(t.effectiveDate), t.status]),
                totalCount: transfers.length,
            };
        },
    },
    promotion: {
        name: 'Promotion Report',
        fetch: async (p) => {
            const { from, to } = rangeDates(p);
            const promotions = await prisma.employeePromotion.findMany({
                where: { employee: p.branchIds ? { branchId: { in: p.branchIds } } : {}, ...(dateBounds(from, to) ? { effectiveDate: dateBounds(from, to) } : {}) },
                include: {
                    employee: { select: { employeeId: true, firstName: true, lastName: true } },
                    fromDesignation: { select: { name: true } }, toDesignation: { select: { name: true } },
                },
                orderBy: { effectiveDate: 'desc' },
            });
            return {
                headers: ['Employee ID', 'Name', 'From Designation', 'To Designation', 'Effective Date', 'Status'],
                rows: promotions.map((p2) => [p2.employee.employeeId ?? '', `${p2.employee.firstName} ${p2.employee.lastName}`, p2.fromDesignation?.name ?? '', p2.toDesignation.name, fmtDate(p2.effectiveDate), p2.status]),
                totalCount: promotions.length,
            };
        },
    },
    confirmation: {
        name: 'Confirmation Report',
        fetch: async (p) => {
            const { from, to } = rangeDates(p);
            const confirmations = await prisma.employeeConfirmation.findMany({
                where: { employee: p.branchIds ? { branchId: { in: p.branchIds } } : {}, ...(dateBounds(from, to) ? { proposedConfirmationDate: dateBounds(from, to) } : {}) },
                include: { employee: { select: { employeeId: true, firstName: true, lastName: true } } },
                orderBy: { proposedConfirmationDate: 'desc' },
            });
            return {
                headers: ['Employee ID', 'Name', 'Confirmation Date', 'Status'],
                rows: confirmations.map((c) => [c.employee.employeeId ?? '', `${c.employee.firstName} ${c.employee.lastName}`, fmtDate(c.proposedConfirmationDate), c.status]),
                totalCount: confirmations.length,
            };
        },
    },
    'leave-register': {
        name: 'Leave Register',
        fetch: async (p) => {
            const { from, to } = rangeDates(p);
            const applications = await prisma.leaveApplication.findMany({
                where: {
                    employee: p.branchIds ? { branchId: { in: p.branchIds } } : {},
                    ...(p.employeeId ? { employeeId: p.employeeId } : {}),
                    ...(to ? { fromDate: { lte: to } } : {}),
                    ...(from ? { toDate: { gte: from } } : {}),
                },
                include: {
                    employee: { select: { employeeId: true, firstName: true, lastName: true, department: { select: { name: true } } } },
                    leaveType: { select: { leaveType: true } },
                },
                orderBy: { fromDate: 'desc' },
            });
            return {
                headers: ['Employee ID', 'Name', 'Department', 'Leave Type', 'From', 'To', 'Days', 'Status'],
                rows: applications.map((a) => [a.employee.employeeId ?? '', `${a.employee.firstName} ${a.employee.lastName}`, a.employee.department?.name ?? '', a.leaveType.leaveType, fmtDate(a.fromDate), fmtDate(a.toDate), fmtDays(a.numberOfDays), a.status]),
                totalCount: applications.length,
            };
        },
    },
    'leave-balance': {
        name: 'Leave Balance Report',
        // Scoped to the current calendar month — EmployeeLeaveBalance is now one
        // row per employee+leaveType+month (see
        // attendance-hr/plan-leave-carry-forward.md), so an unscoped query would
        // return every historical month's row instead of "current status".
        fetch: async (p) => {
            // Balances are one row per employee + leave type + month: use the chosen month/year, else the current IST month.
            const current = getKolkataMonthBounds();
            const month = p.month ?? current.month;
            const year = p.year ?? current.year;
            const balances = await prisma.employeeLeaveBalance.findMany({
                where: { isActive: true, month, year, employee: p.branchIds ? { branchId: { in: p.branchIds } } : {}, ...(p.employeeId ? { employeeId: p.employeeId } : {}) },
                include: { employee: { select: { employeeId: true, firstName: true, lastName: true } }, leaveType: { select: { leaveType: true } } },
                orderBy: { employee: { firstName: 'asc' } },
            });
            return {
                headers: ['Employee ID', 'Name', 'Leave Type', 'Opening Balance', 'Carried Forward', 'Remaining Balance'],
                rows: balances.map((b) => [b.employee.employeeId ?? '', `${b.employee.firstName} ${b.employee.lastName}`, b.leaveType.leaveType, fmtDays(b.openingBalance), fmtDays(b.carriedForwardDays), fmtDays(b.remainingBalance)]),
                totalCount: balances.length,
            };
        },
    },
    absentee: {
        name: 'Absentee Report',
        // status: 'ABSENT' covers both a genuine no-show and an approved full-day
        // leave (leave approval upserts the Attendance row with status ABSENT +
        // leaveTypeId — see app/api/hr/leave/[id]/approve/route.ts:189-196), so
        // the same "Leave" column used on the Missed Punch In report is added
        // here too, to tell them apart without dropping either from the list.
        fetch: async (p) => {
            const { from, to } = rangeDates(p);
            if (!from || !to) throw new Error('fromDate and toDate are required for the Absentee report');
            const records = await prisma.attendance.findMany({
                where: {
                    status: 'ABSENT', date: { gte: from, lte: to },
                    ...(p.branchIds ? { branchId: { in: p.branchIds } } : {}),
                    ...(p.employeeId ? { userId: p.employeeId } : {}),
                },
                include: {
                    user: { select: { employeeId: true, firstName: true, lastName: true } },
                    branch: { select: { name: true } },
                    leaveType: { select: { leaveType: true } },
                },
                orderBy: { date: 'desc' },
            });
            return {
                headers: ['Date', 'Employee ID', 'Name', 'Branch', 'Status', 'Leave'],
                rows: records.map((r) => [fmtDate(r.date), r.user.employeeId ?? '', `${r.user.firstName} ${r.user.lastName}`, r.branch?.name ?? '', r.status, r.leaveType?.leaveType ?? '']),
                totalCount: records.length,
            };
        },
    },
    'holiday-register': {
        name: 'Holiday Report',
        // Branch holidays and working-day overrides from the Holiday Calendar
        // (`Holiday` table). One row per branch per date; an "all branches"
        // holiday therefore shows once for every branch it was applied to.
        fetch: async (p) => {
            const { from, to } = rangeDates(p);
            if (!from || !to) throw new Error('fromDate and toDate are required for the Holiday report');

            const rows = await prisma.holiday.findMany({
                where: {
                    date: { gte: from, lte: to },
                    ...(p.branchIds ? { branchId: { in: p.branchIds } } : {}),
                    ...(p.type === 'HOLIDAY' ? { isWorkingDay: false } : p.type === 'WORKING_DAY' ? { isWorkingDay: true } : {}),
                },
                include: { branch: { select: { name: true, code: true } } },
                orderBy: [{ date: 'asc' }, { branch: { name: 'asc' } }],
            });

            const creatorIds = Array.from(new Set(rows.map((r) => r.createdById).filter((id): id is string => !!id)));
            const creators = creatorIds.length
                ? await prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, firstName: true, lastName: true } })
                : [];
            const creatorName = new Map(creators.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));

            const fmtYmd = (d: Date) => {
                const [y, m, day] = getKolkataCalendarYmd(d).split('-');
                return `${day}/${m}/${y}`;
            };

            return {
                headers: ['S.No', 'Date', 'Day', 'Branch', 'Type', 'Reason', 'Set By'],
                rows: rows.map((r, i) => [
                    i + 1,
                    fmtYmd(r.date),
                    r.date.toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'Asia/Kolkata' }),
                    r.branch ? `${r.branch.code} - ${r.branch.name}` : '',
                    r.isWorkingDay ? 'Working Day (override)' : 'Holiday',
                    r.reason ?? '',
                    r.createdById ? (creatorName.get(r.createdById) ?? '') : '',
                ]),
                totalCount: rows.length,
            };
        },
    },
    'missed-punch-in': {
        name: 'Missed Punch In Report',
        // Employees who DID punch in but never punched out — checkIn set,
        // checkOut still null. Everyone else (never punched in at all, no
        // Attendance row, on approved leave, holiday) is deliberately excluded
        // per the user's explicit instruction, even though the report's own
        // name still says "Punch In" (kept as-is — not asked to rename it).
        // Filtered by role (not by a single employee) — the user asked for a
        // role filter here instead.
        fetch: async (p) => {
            const { from, to } = rangeDates(p);
            if (!from || !to) throw new Error('fromDate and toDate are required for the Missed Punch In report');

            const records = await prisma.attendance.findMany({
                where: {
                    checkIn: { not: null }, checkOut: null, date: { gte: from, lte: to },
                    ...(p.branchIds ? { branchId: { in: p.branchIds } } : {}),
                    ...(p.role ? { user: { role: p.role } } : {}),
                },
                include: { user: { select: { employeeId: true, firstName: true, lastName: true, role: true } }, branch: { select: { name: true } } },
                orderBy: { date: 'desc' },
            });

            return {
                headers: ['S.No', 'Date', 'Employee ID', 'Name', 'Role', 'Branch', 'Punch In', 'Status'],
                rows: records.map((r, i) => [
                    i + 1, fmtDate(r.date), r.user.employeeId ?? '', `${r.user.firstName} ${r.user.lastName}`,
                    r.user.role, r.branch?.name ?? '', r.checkIn ? r.checkIn.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }) : '', r.status,
                ]),
                totalCount: records.length,
            };
        },
    },
    'late-attendance': {
        name: 'Late Attendance Report',
        fetch: async (p) => {
            const { from, to } = rangeDates(p);
            if (!from || !to) throw new Error('fromDate and toDate are required for the Late Attendance report');
            
            const defaultShift = await resolveDefaultShiftConfig();

            const records = await prisma.attendance.findMany({
                where: {
                    checkIn: { not: null },
                    date: { gte: from, lte: to },
                    ...(p.branchIds ? { branchId: { in: p.branchIds } } : {}),
                    ...(p.employeeId ? { userId: p.employeeId } : {}),
                    ...(p.shiftId && p.shiftId !== 'all' ? { user: { shiftId: p.shiftId } } : {}),
                },
                include: {
                    user: {
                        select: {
                            employeeId: true,
                            firstName: true,
                            lastName: true,
                            shiftId: true,
                            shift: {
                                select: { id: true, name: true, shiftStart: true, shiftEnd: true, graceMinutes: true, isActive: true },
                            },
                        },
                    },
                    branch: { select: { name: true } },
                },
                orderBy: { date: 'desc' },
            });

            const lateRows: (string | number)[][] = [];
            for (const r of records) {
                if (!r.checkIn) continue;
                const shift = r.user.shift?.isActive
                    ? r.user.shift
                    : { id: defaultShift.shiftId, name: defaultShift.shiftName ?? 'Default', shiftStart: defaultShift.shiftStart, shiftEnd: defaultShift.shiftEnd, graceMinutes: defaultShift.graceMinutes };

                const checkInDate = new Date(r.checkIn);
                const parts = new Intl.DateTimeFormat('en-GB', {
                    timeZone: 'Asia/Kolkata',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false,
                }).formatToParts(checkInDate);
                const h = Number(parts.find((x) => x.type === 'hour')?.value ?? 0);
                const m = Number(parts.find((x) => x.type === 'minute')?.value ?? 0);
                const checkInMinutes = h * 60 + m;

                const [sh, sm] = shift.shiftStart.split(':').map(Number);
                const shiftStartMinutes = sh * 60 + (sm || 0);
                const diff = checkInMinutes - (shiftStartMinutes + (shift.graceMinutes || 0));

                if (diff > 0) {
                    const lateHours = Math.floor(diff / 60);
                    const lateMins = diff % 60;
                    const lateByStr = lateHours > 0 ? `${lateHours}h ${lateMins}m` : `${lateMins}m`;
                    const shiftLabel = `${shift.name} (${shift.shiftStart} - ${shift.shiftEnd})`;
                    const checkInStr = checkInDate.toLocaleTimeString('en-IN', {
                        timeZone: 'Asia/Kolkata',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: true,
                    });

                    lateRows.push([
                        fmtDate(r.date),
                        r.user.employeeId ?? '',
                        `${r.user.firstName} ${r.user.lastName}`,
                        r.branch?.name ?? '',
                        shiftLabel,
                        checkInStr,
                        lateByStr,
                    ]);
                }
            }

            return {
                headers: ['Date', 'Employee ID', 'Name', 'Branch', 'Assigned Shift', 'Check-In Time', 'Late By'],
                rows: lateRows,
                totalCount: lateRows.length,
            };
        },
    },
    'permission-register': {
        name: 'Permission Register',
        fetch: async (p) => {
            const { from, to } = rangeDates(p);
            const requests = await prisma.permissionRequest.findMany({
                where: {
                    employee: p.branchIds ? { branchId: { in: p.branchIds } } : {},
                    ...(p.employeeId ? { employeeId: p.employeeId } : {}),
                    ...(dateBounds(from, to) ? { date: dateBounds(from, to) } : {}),
                },
                include: {
                    employee: { select: { employeeId: true, firstName: true, lastName: true, department: { select: { name: true } }, branch: { select: { name: true } } } },
                    permissionType: { select: { permissionType: true } },
                },
                orderBy: { date: 'desc' },
            });
            return {
                headers: ['Date', 'Employee ID', 'Name', 'Branch', 'Permission Type', 'From', 'To', 'Hours', 'Status', 'Reason'],
                rows: requests.map((r) => [
                    fmtDate(r.date),
                    r.employee.employeeId ?? '',
                    `${r.employee.firstName} ${r.employee.lastName}`,
                    r.employee.branch?.name ?? '',
                    r.permissionType.permissionType,
                    r.fromTime,
                    r.toTime,
                    Number(r.hours),
                    r.status,
                    r.reason ?? '',
                ]),
                totalCount: requests.length,
            };
        },
    },
    'salary-register': {
        // Relabeled "Payroll Report" in the catalog — same slug/route so no
        // link breaks, but the columns now match the org's Payroll excel
        // sheet exactly (Month CTC Pay -> Basic/HRA -> LOP-prorated Actual
        // figures -> Total Earnings/Deductions -> Net Pay). Reads only
        // already-computed, already-stamped values from SalaryPayRecord/
        // SalaryPayLineItem (totalPaidDays/lopDays frozen at submit time) —
        // no live recomputation, so a historical payslip never drifts if CTC
        // or attendance changes later.
        name: 'Payroll Report',
        // Column-for-column match to the org's "Payroll" excel sheet
        // (S.No through Net Pay, 33 columns, including the sheet's own
        // Month CTC Pay column appearing twice and Basic/HRA appearing both
        // full and LOP-prorated ("Actual") — see the fetch body for how each
        // is derived). Reads only already-computed, already-stamped values
        // from SalaryPayRecord/SalaryPayLineItem (totalPaidDays/lopDays/
        // monthlyCtc frozen at submit time) — no live recomputation, so a
        // historical payslip never drifts if CTC/attendance/designation %
        // changes later.
        fetch: async (p) => {
            const records = await prisma.salaryPayRecord.findMany({
                where: {
                    employee: p.branchIds ? { branchId: { in: p.branchIds } } : {},
                    ...(p.employeeId ? { employeeId: p.employeeId } : {}),
                    ...(p.month ? { month: p.month } : {}),
                    ...(p.year ? { year: p.year } : {}),
                },
                include: {
                    employee: {
                        select: {
                            employeeId: true, firstName: true, lastName: true, dateOfJoining: true, isActive: true,
                            branch: { select: { id: true, code: true, name: true, areas: { select: { name: true, division: { select: { name: true, region: { select: { name: true } } } } } } } },
                            designation: { select: { name: true } }, department: { select: { name: true } },
                        },
                    },
                    lineItems: { include: { salaryComponent: { select: { name: true } } } },
                },
                orderBy: [{ year: 'desc' }, { month: 'desc' }],
            });

            const amountFor = (r: (typeof records)[number], name: string) => {
                const li = r.lineItems.find((x) => x.salaryComponent.name.trim().toLowerCase() === name);
                return li ? Number(li.amount) : 0;
            };

            return {
                headers: [
                    'S.No', 'Emp Name', 'Emp ID', 'Status', 'Date of Joining', 'Region', 'Division', 'Area', 'Branch ID', 'Branch Name',
                    'Designation', 'Department', 'Total Paid Days', 'LOP', 'Month CTC Pay', 'Basic', 'HRA', 'Month CTC Pay', 'Working days',
                    'Actual Basic', 'Actual HRA', 'Actual Gross', 'Arrear Salary', 'Monthly Incentive', 'Total Earnings',
                    'PF', 'ESI', 'Other Deductions', 'STAFF LOAN', 'STAFF ADVANCE', 'Total Deduction', 'Net Salary With Incentive', 'Net Pay',
                ],
                rows: records.map((r, i) => {
                    const totalPaidDays = r.totalPaidDays ?? 0;
                    const lopDays = r.lopDays ? Number(r.lopDays) : 0;
                    const workingDays = Math.max(0, totalPaidDays - lopDays);
                    const monthlyCtc = r.monthlyCtc ? Number(r.monthlyCtc) : 0;
                    const actualBasic = amountFor(r, 'basic');
                    const actualHra = amountFor(r, 'hra');
                    const actualGross = actualBasic + actualHra;
                    // Full (unprorated) Basic/HRA, derived from the stamped
                    // monthlyCtc and this record's own Actual Basic/Gross
                    // ratio — avoids a fresh Designation-% lookup that could
                    // drift from what was actually used at the time this
                    // payslip was posted.
                    const { basic, hra } = deriveFullBasicHra({ monthlyCtc, actualBasic, actualGross });
                    const arrear = amountFor(r, 'arrear salary');
                    const incentive = amountFor(r, 'monthly incentive');
                    const netPayable = Number(r.netPayable);
                    const area = r.employee.branch?.areas?.[0];
                    return [
                        i + 1, `${r.employee.firstName} ${r.employee.lastName}`.trim(), r.employee.employeeId ?? '', r.employee.isActive ? 'Live' : 'Exit',
                        fmtDate(r.employee.dateOfJoining), area?.division?.region?.name ?? '', area?.division?.name ?? '', area?.name ?? '',
                        r.employee.branch?.code ?? '', r.employee.branch?.name ?? '', r.employee.designation?.name ?? '', r.employee.department?.name ?? '',
                        totalPaidDays, lopDays, monthlyCtc, basic, hra, monthlyCtc, workingDays,
                        actualBasic, actualHra, actualGross, arrear, incentive, Number(r.totalEarnings),
                        amountFor(r, 'pf'), amountFor(r, 'esi'), amountFor(r, 'other deductions'), amountFor(r, 'staff loan'), amountFor(r, 'staff advance'),
                        Number(r.totalDeductions), netPayable, netPayable - incentive,
                    ];
                }),
                totalCount: records.length,
            };
        },
    },
    'staff-loan-deduction': {
        name: 'Staff Loan Deduction Report',
        fetch: async (p) => fetchDeductionLineItems(p, 'Staff Loan'),
    },
    'staff-advance-deduction': {
        name: 'Staff Advance Deduction Report',
        fetch: async (p) => fetchDeductionLineItems(p, 'Staff Advance'),
    },
    'travel-client-visit': {
        name: 'Travel & Client Visit Report',
        fetch: async (p) => {
            const { from, to } = rangeDates(p);
            if (!from || !to) throw new Error('fromDate and toDate are required for the Travel & Client Visit report');

            const employees = await prisma.user.findMany({
                where: { isActive: true, ...(p.branchIds ? { branchId: { in: p.branchIds } } : {}), ...(p.employeeId ? { id: p.employeeId } : {}) },
                select: { id: true, employeeId: true, firstName: true, lastName: true, branch: { select: { name: true } } },
            });

            const rows: (string | number)[][] = [];
            for (let t = from.getTime(); t <= to.getTime(); t += 24 * 60 * 60 * 1000) {
                const { dayStartUtc, dayEndUtc } = getUtcBoundsForBranchCalendarDay(new Date(t));
                for (const emp of employees) {
                    // CLIENT_VISIT (and Punch In/Out) now live in EmployeeTrackingEvent,
                    // not EmployeeLocationPing (see attendance-hr/architecture-live-tracking.md)
                    // — query both and merge, same pattern as the tracking detail route.
                    const [attendance, pings, events, enrolledCount, createdCenterCount, collectionRecords] = await Promise.all([
                        prisma.attendance.findUnique({ where: { userId_date: { userId: emp.id, date: dayStartUtc } } }),
                        prisma.employeeLocationPing.findMany({
                            where: { employeeId: emp.id, capturedAt: { gte: dayStartUtc, lte: dayEndUtc } },
                            orderBy: { capturedAt: 'asc' },
                        }),
                        prisma.employeeTrackingEvent.findMany({
                            where: { employeeId: emp.id, capturedAt: { gte: dayStartUtc, lte: dayEndUtc } },
                            orderBy: { capturedAt: 'asc' },
                        }),
                        prisma.client.count({
                            where: { enrolledById: emp.id, createdAt: { gte: dayStartUtc, lte: dayEndUtc } },
                        }),
                        prisma.center.count({
                            where: { createdById: emp.id, createdAt: { gte: dayStartUtc, lte: dayEndUtc } },
                        }),
                        prisma.collectionMeetingRecord.findMany({
                            where: {
                                submittedById: emp.id,
                                OR: [
                                    { collectionDate: { gte: dayStartUtc, lte: dayEndUtc } },
                                    { submittedAt: { gte: dayStartUtc, lte: dayEndUtc } },
                                ],
                            },
                            select: { totalAmount: true },
                        }),
                    ]);
                    if (!attendance && pings.length === 0 && events.length === 0 && enrolledCount === 0 && createdCenterCount === 0 && collectionRecords.length === 0) continue;

                    const trackingPings: TrackingPing[] = [
                        ...pings.map((pg) => ({ latitude: pg.latitude, longitude: pg.longitude, capturedAt: pg.capturedAt, activityType: pg.activityType, clientId: null, accuracyMeters: pg.accuracyMeters })),
                        ...events.map((ev) => ({ latitude: ev.latitude, longitude: ev.longitude, capturedAt: ev.capturedAt, activityType: ev.eventType, clientId: ev.clientId, accuracyMeters: ev.accuracyMeters })),
                    ].sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
                    const clientsVisited = new Set(events.filter((ev) => ev.eventType === 'CLIENT_VISIT' && ev.clientId).map((ev) => ev.clientId)).size;
                    const membersEnrolled = Math.max(events.filter((ev) => ev.eventType === 'MEMBER_ENROLLED').length, enrolledCount);
                    const centersCreated = Math.max(events.filter((ev) => ev.eventType === 'CENTER_CREATED').length, createdCenterCount);
                    const collectionsCount = Math.max(events.filter((ev) => ev.eventType === 'COLLECTION').length, collectionRecords.length);
                    const collectionAmount = collectionRecords.reduce((sum, r) => sum + Number(r.totalAmount || 0), 0);
                    const first = trackingPings[0];
                    const last = trackingPings[trackingPings.length - 1];

                    rows.push([
                        rows.length + 1,
                        fmtDate(new Date(t)),
                        emp.employeeId ?? '',
                        `${emp.firstName} ${emp.lastName}`,
                        emp.branch?.name ?? '',
                        attendance?.checkIn ? attendance.checkIn.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }) : '',
                        attendance?.checkOut ? attendance.checkOut.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' }) : '',
                        clientsVisited,
                        membersEnrolled,
                        centersCreated,
                        collectionsCount,
                        collectionAmount,
                        computeTravelledKm(trackingPings),
                        first ? `${first.latitude.toFixed(4)}, ${first.longitude.toFixed(4)}` : '',
                        last ? `${last.latitude.toFixed(4)}, ${last.longitude.toFixed(4)}` : '',
                    ]);
                }
            }

            return {
                headers: [
                    'S.No',
                    'Date',
                    'Employee ID',
                    'Employee Name',
                    'Branch',
                    'Punch In',
                    'Punch Out',
                    'Clients Visited',
                    'Members Enrolled',
                    'Centers Created',
                    'Collections',
                    'Collection Amount (₹)',
                    'Travel KM',
                    'First Location',
                    'Last Location',
                ],
                rows,
                totalCount: rows.length,
            };
        },
    },
    'travel-similarity': {
        name: 'Travel Path Similarity Report',
        // See attendance-hr/plan-travel-similarity-report.md for the full algorithm design
        // (symmetric comparison, segment matching not blind point matching, exact temporal
        // overlap definition). Defaults chosen here (documented, not hard requirements):
        // match distance 100m, minimum 2km shared to report a pair, same-branch pairs only
        // (O(n²) pairs get expensive fast — cross-branch would need to be a slower opt-in),
        // 150m office-radius exclusion so every pair doesn't trivially "match" at the branch.
        // Does not touch or reuse travel-client-visit's own inline query logic above.
        fetch: async (p) => {
            const { from, to } = rangeDates(p);
            if (!from || !to) throw new Error('fromDate and toDate are required for the Travel Path Similarity report');

            const MATCH_DISTANCE_METERS = 100;
            const MIN_SHARED_KM_TO_REPORT = 2;
            const OFFICE_EXCLUSION_RADIUS_METERS = 150;

            const employees = await prisma.user.findMany({
                where: { isActive: true, ...(p.branchIds ? { branchId: { in: p.branchIds } } : {}) },
                select: {
                    id: true, employeeId: true, firstName: true, lastName: true, branchId: true,
                    branch: { select: { name: true, latitude: true, longitude: true } },
                },
            });

            const byBranch = new Map<string, typeof employees>();
            for (const emp of employees) {
                if (!emp.branchId) continue;
                const list = byBranch.get(emp.branchId) ?? [];
                list.push(emp);
                byBranch.set(emp.branchId, list);
            }

            const rows: (string | number)[][] = [];

            for (let t = from.getTime(); t <= to.getTime(); t += 24 * 60 * 60 * 1000) {
                const { dayStartUtc, dayEndUtc } = getUtcBoundsForBranchCalendarDay(new Date(t));

                for (const branchEmployees of byBranch.values()) {
                    if (branchEmployees.length < 2) continue;
                    const office = branchEmployees[0].branch;

                    const pathEntries = await Promise.all(
                        branchEmployees.map(async (emp) => {
                            const points = await getEmployeeDayRoutePoints(emp.id, dayStartUtc, dayEndUtc);
                            const filtered = office?.latitude != null && office?.longitude != null
                                ? filterNearPoint(points, { latitude: office.latitude, longitude: office.longitude }, OFFICE_EXCLUSION_RADIUS_METERS)
                                : points;
                            return [emp.id, filtered] as const;
                        }),
                    );
                    const paths = new Map(pathEntries.filter(([, pts]) => pts.length >= 2));
                    const withPaths = branchEmployees.filter((e) => paths.has(e.id));

                    for (let i = 0; i < withPaths.length; i++) {
                        for (let j = i + 1; j < withPaths.length; j++) {
                            const empA = withPaths[i];
                            const empB = withPaths[j];
                            const result = computeRouteSimilarity(paths.get(empA.id)!, paths.get(empB.id)!, { matchDistanceMeters: MATCH_DISTANCE_METERS });
                            if (result.sharedDistanceKm < MIN_SHARED_KM_TO_REPORT) continue;

                            rows.push([
                                rows.length + 1,
                                fmtDate(new Date(t)),
                                empA.employeeId ?? '',
                                `${empA.firstName} ${empA.lastName}`,
                                empB.employeeId ?? '',
                                `${empB.firstName} ${empB.lastName}`,
                                empA.branch?.name ?? '',
                                result.similarityPercent,
                                result.sharedDistanceKm,
                                result.totalDistanceAKm,
                                result.totalDistanceBKm,
                                result.sharedTimeMinutes,
                                result.segmentsMatched,
                            ]);
                        }
                    }
                }
            }

            return {
                headers: [
                    'S.No', 'Date', 'Employee 1 ID', 'Employee 1 Name', 'Employee 2 ID', 'Employee 2 Name',
                    'Branch', 'Similarity %', 'Shared Distance (KM)', 'Employee 1 Total KM', 'Employee 2 Total KM',
                    'Shared Time (min)', 'Segments Matched',
                ],
                rows,
                totalCount: rows.length,
            };
        },
    },
};

async function fetchDeductionLineItems(p: ReportParams, componentName: string): Promise<ReportRows> {
    const lineItems = await prisma.salaryPayLineItem.findMany({
        where: {
            salaryComponent: { name: componentName },
            salaryPayRecord: {
                employee: p.branchIds ? { branchId: { in: p.branchIds } } : {},
                ...(p.employeeId ? { employeeId: p.employeeId } : {}),
                ...(p.month ? { month: p.month } : {}),
                ...(p.year ? { year: p.year } : {}),
            },
        },
        include: {
            salaryPayRecord: { include: { employee: { select: { employeeId: true, firstName: true, lastName: true } } } },
        },
        orderBy: [{ salaryPayRecord: { year: 'desc' } }, { salaryPayRecord: { month: 'desc' } }],
    });
    return {
        headers: ['Employee ID', 'Name', 'Month', 'Year', 'Amount'],
        rows: lineItems.map((li) => [
            li.salaryPayRecord.employee.employeeId ?? '', `${li.salaryPayRecord.employee.firstName} ${li.salaryPayRecord.employee.lastName}`,
            li.salaryPayRecord.month, li.salaryPayRecord.year, Number(li.amount),
        ]),
        totalCount: lineItems.length,
    };
}

/** Month / year query param -> integer within range, or null when absent or invalid. */
function toMonthOrYear(raw: string | null, min: number, max: number): number | null {
    if (!raw) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

// GET /api/hr/reports/[slug]?fromDate=&toDate=&employeeId=
// These reports surface payroll/salary/leave data — gated on hr-payroll:view
// (HR/managerial staff only, not every branch role, unlike operational MIS
// reports like collections).
export async function GET(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
    const ctx = await requirePermission(request, 'hr-payroll', 'view');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { slug } = await params;
        const entry = REPORTS[slug];
        if (!entry) return errorResponse(`Unknown HR report: ${slug}`, 404);

        const { searchParams } = new URL(request.url);
        const permittedBranchIds = await getPermittedBranchIdsForContext(ctx);

        // Optional UI branch filter — narrows to one branch instead of the
        // user's whole permitted set. Only honored when it's actually within
        // what this user can see (head office can pick any branch; everyone
        // else can only narrow among their own permitted branches, never
        // outside it).
        const requestedBranchIdParam = searchParams.get('branchId');
        const requestedBranchId = requestedBranchIdParam && requestedBranchIdParam !== 'all' ? requestedBranchIdParam : null;
        let branchIds = permittedBranchIds;
        if (requestedBranchId) {
            if (permittedBranchIds === null || permittedBranchIds.includes(requestedBranchId)) {
                branchIds = [requestedBranchId];
            } else {
                return errorResponse('You do not have access to this branch', 403);
            }
        }

        const result = await entry.fetch({
            fromDate: searchParams.get('fromDate'),
            toDate: searchParams.get('toDate'),
            branchIds,
            employeeId: searchParams.get('employeeId'),
            shiftId: searchParams.get('shiftId'),
            role: searchParams.get('role'),
            type: searchParams.get('type'),
            status: searchParams.get('status'),
            month: toMonthOrYear(searchParams.get('month'), 1, 12),
            year: toMonthOrYear(searchParams.get('year'), 2000, 2100),
        });

        return successResponse({ reportName: entry.name, ...result }, `${entry.name} fetched successfully`);
    } catch (error: any) {
        console.error('Error fetching HR report:', error);
        return errorResponse(error.message || 'Failed to fetch HR report', 500);
    }
}
