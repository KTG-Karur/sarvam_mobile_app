import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { getKolkataCalendarYmd } from '@/app/lib/branch-lock';
import { StaffLoanConfigurationError } from '@/app/lib/staff-loans/configuration-service';
import { registerScope, type StaffLoanActor } from '@/app/lib/staff-loans/application-access';
import { computeRepayment } from '@/app/lib/staff-loans/application-service';
import { advancePageScope } from '@/app/lib/staff-advances/access';
import { getAdvanceSalarySummary } from '@/app/lib/staff-advances/salary';
import { ADVANCE_MANAGEMENT_PAGE } from '@/app/lib/staff-advances/advance';
import { formatDayMonthYear, formatMonthYear } from '@/app/lib/staff-settlement/format';
import type { ScheduleDetail, ScheduleKind, ScheduleList, ScheduleListItem, ScheduleRowView } from './schedule-types';

/**
 * Staff Loan / Staff Advance reports for the HR Reports section. Every figure comes from the existing schedule and
 * POSTED-allocation ledger (loans through `computeRepayment`, the one function the loan screens use), so a report
 * can never disagree with the loan/advance pages. Nothing here writes data.
 *
 * Access follows the Staff Loan / Staff Advance registers: an admin or HR user sees every loan/advance inside their
 * branch access; anyone else needs the "view" grant on Loan Management / Advance Management, limited to the
 * branches of the role assignment that carries it. Loans and advances are scoped independently.
 */

export const STAFF_REPORT_SLUGS = ['active-staff-loans', 'active-staff-advances', 'staff-outstanding', 'staff-loan-closure', 'staff-advance-closure'] as const;
export type StaffReportSlug = (typeof STAFF_REPORT_SLUGS)[number];

export const staffReportFilterSchema = z.object({
    search: z.string().trim().max(100).optional(),
    branchId: z.string().min(1).optional().transform((v) => (v === 'all' ? undefined : v)),
    departmentId: z.string().min(1).optional(),
    employeeId: z.string().min(1).optional(),
    /** Report-specific status filter (see each report); empty / "all" = no filter. */
    status: z.string().max(30).optional(),
    /** Closure reports: closed between these dates (YYYY-MM-DD, inclusive, IST). */
    fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    /** One loan / advance (the schedule detail). */
    id: z.string().min(1).optional(),
    /** Total Staff Outstanding only: LOAN, ADVANCE or all. */
    type: z.enum(['LOAN', 'ADVANCE']).optional(),
}).strict();
export type StaffReportFilters = z.infer<typeof staffReportFilterSchema>;

export type StaffReportResult = {
    reportName: string;
    headers: string[];
    rows: (string | number)[][];
    totalCount: number;
    /** Top-of-page summary cards. `money` values are shown as currency. */
    summary: { label: string; value: number; money: boolean }[];
    /** Column indexes that hold rupee amounts (shown as currency; exported as plain numbers). */
    moneyColumns: number[];
};

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const dec = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const isoDay = (date: Date) => date.toISOString().split('T')[0];
const sum = (values: number[]) => round2(values.reduce((total, v) => total + v, 0));
const all = (value: string | undefined) => (!value || value === 'all' ? undefined : value);

/** Payroll is computed once per employee, so run it a few at a time instead of all at once. */
const SALARY_CONCURRENCY = 6;
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const results = new Array<R>(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const index = next++;
            results[index] = await fn(items[index]);
        }
    }));
    return results;
}

// ── scope ─────────────────────────────────────────────────────────────────

const branchScope = (actor: StaffLoanActor) => (actor.branchIds === null ? {} : { branchId: { in: actor.branchIds } });

function loanScope(actor: StaffLoanActor): Prisma.StaffLoanWhereInput | null {
    return actor.isHR && !actor.isAdmin ? branchScope(actor) : registerScope(actor);
}
function advanceScope(actor: StaffLoanActor): Prisma.StaffAdvanceWhereInput | null {
    return actor.isHR && !actor.isAdmin ? branchScope(actor) : advancePageScope(actor, ADVANCE_MANAGEMENT_PAGE);
}

/** The requested branch must be inside the user's branch access; it can only narrow, never widen. */
function checkBranch(actor: StaffLoanActor, branchId: string | undefined) {
    if (branchId && actor.branchIds !== null && !actor.branchIds.includes(branchId)) {
        throw new StaffLoanConfigurationError('You do not have access to this branch.', 403);
    }
}

function commonWhere(filters: StaffReportFilters, numberField: 'loanNumber' | 'advanceNumber') {
    const term = filters.search;
    return {
        ...(filters.branchId ? { branchId: filters.branchId } : {}),
        ...(filters.id ? { id: filters.id } : {}),
        ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
        ...(filters.departmentId ? { employee: { departmentId: filters.departmentId } } : {}),
        ...(term ? {
            OR: [
                { [numberField]: { contains: term, mode: 'insensitive' as const } },
                { employee: { firstName: { contains: term, mode: 'insensitive' as const } } },
                { employee: { lastName: { contains: term, mode: 'insensitive' as const } } },
                { employee: { employeeId: { contains: term, mode: 'insensitive' as const } } },
            ],
        } : {}),
    };
}

// ── loading ───────────────────────────────────────────────────────────────

const employeeSelect = {
    id: true, employeeId: true, firstName: true, lastName: true, role: true,
    department: { select: { name: true } }, designation: { select: { name: true } }, branch: { select: { name: true } },
} satisfies Prisma.UserSelect;

const loanInclude = {
    employee: { select: employeeSelect }, branch: { select: { name: true } },
    schedules: {
        orderBy: { installmentNo: 'asc' as const },
        include: { allocations: { where: { transaction: { status: 'POSTED' as const } }, select: { principal: true, interest: true, transaction: { select: { transactionDate: true } } } } },
    },
} satisfies Prisma.StaffLoanInclude;
const advanceInclude = {
    employee: { select: employeeSelect }, branch: { select: { name: true } },
    schedules: {
        orderBy: { installmentNo: 'asc' as const },
        include: { allocations: { where: { transaction: { status: 'POSTED' as const } }, select: { amount: true } } },
    },
} satisfies Prisma.StaffAdvanceInclude;
type LoanRecord = Prisma.StaffLoanGetPayload<{ include: typeof loanInclude }>;
type AdvanceRecord = Prisma.StaffAdvanceGetPayload<{ include: typeof advanceInclude }>;

type Person = LoanRecord['employee'];
const person = (e: Person) => ({
    code: e.employeeId ?? '', name: `${e.firstName} ${e.lastName}`.trim(), department: e.department?.name ?? '', designation: e.designation?.name ?? e.role,
});

async function loadLoans(actor: StaffLoanActor, filters: StaffReportFilters, statuses: Prisma.StaffLoanWhereInput['status']) {
    const scope = loanScope(actor);
    if (!scope) return null;
    checkBranch(actor, filters.branchId);
    return prisma.staffLoan.findMany({
        where: { AND: [scope, { status: statuses }, commonWhere(filters, 'loanNumber')] },
        include: loanInclude, orderBy: [{ loanNumber: 'asc' }],
    });
}
async function loadAdvances(actor: StaffLoanActor, filters: StaffReportFilters, statuses: Prisma.StaffAdvanceWhereInput['status']) {
    const scope = advanceScope(actor);
    if (!scope) return null;
    checkBranch(actor, filters.branchId);
    return prisma.staffAdvance.findMany({
        where: { AND: [scope, { status: statuses }, commonWhere(filters, 'advanceNumber')] },
        include: advanceInclude, orderBy: [{ advanceNumber: 'asc' }],
    });
}

const noAccess = () => new StaffLoanConfigurationError('You do not have access to this report.', 403);

// ── per-obligation figures ────────────────────────────────────────────────

function loanFigures(loan: LoanRecord) {
    const r = computeRepayment(loan.schedules);
    const pending = r.schedules.filter(s => s.status !== 'PAID');
    return {
        r,
        loanAmount: Number(loan.approvedAmount ?? loan.requestedAmount),
        totalRepayable: r.totalPrincipalDue.plus(r.totalInterestDue).toNumber(),
        paid: r.totalPrincipalPaid.plus(r.totalInterestPaid).toNumber(),
        principalOutstanding: r.principalOutstanding.toNumber(),
        interestOutstanding: r.interestOutstanding.toNumber(),
        totalOutstanding: r.totalOutstanding.toNumber(),
        monthly: loan.schedules[0] ? dec(loan.schedules[0].principalDue).plus(loan.schedules[0].interestDue).toNumber() : 0,
        remaining: pending.length,
        nextDueMonth: pending[0] ? formatMonthYear(pending[0].dueDate) : '',
        status: pending.some(s => s.status === 'OVERDUE') ? 'OVERDUE' : 'ACTIVE',
    };
}

function advanceRows(advance: AdvanceRecord, today: string) {
    return advance.schedules.map(s => {
        const due = dec(s.amountDue);
        const paid = s.allocations.reduce((total, a) => total.plus(a.amount), dec(0));
        const outstanding = Prisma.Decimal.max(0, due.minus(paid));
        const dueDate = isoDay(s.dueDate);
        const status: 'PAID' | 'PARTIAL' | 'PENDING' | 'OVERDUE' = outstanding.lessThanOrEqualTo(0.001) ? 'PAID' : paid.greaterThan(0) ? 'PARTIAL' : dueDate < today ? 'OVERDUE' : 'PENDING';
        return { installmentNo: s.installmentNo, dueDate, due: due.toNumber(), paid: paid.toNumber(), outstanding: outstanding.toNumber(), status };
    });
}

function advanceFigures(advance: AdvanceRecord, today: string) {
    const rows = advanceRows(advance, today);
    const pending = rows.filter(s => s.status !== 'PAID');
    return {
        rows,
        amount: Number(advance.amount),
        paid: sum(rows.map(s => s.paid)),
        outstanding: sum(rows.map(s => s.outstanding)),
        monthly: advance.schedules[0] ? Number(advance.schedules[0].amountDue) : 0,
        remaining: pending.length,
        nextDueMonth: pending[0] ? formatMonthYear(pending[0].dueDate) : '',
        status: pending.some(s => s.status === 'OVERDUE') ? 'OVERDUE' : 'ACTIVE',
    };
}

const statusMatches = (status: string, filter: string | undefined) => !all(filter) || status === filter;

// ── reports ───────────────────────────────────────────────────────────────

async function activeStaffLoans(actor: StaffLoanActor, filters: StaffReportFilters): Promise<StaffReportResult> {
    const loans = await loadLoans(actor, filters, 'ACTIVE');
    if (!loans) throw noAccess();
    const items = loans.map(loan => ({ loan, f: loanFigures(loan) })).filter(({ f }) => statusMatches(f.status, filters.status));
    return {
        reportName: 'Active Staff Loan Report',
        headers: [
            'Loan Number', 'Employee ID', 'Employee Name', 'Department', 'Designation', 'Branch', 'Loan Amount', 'Total Repayable', 'Principal Outstanding',
            'Interest Outstanding', 'Total Outstanding', 'Monthly Repayment', 'Paid Amount', 'Remaining Installments', 'Next Due Month', 'Status',
        ],
        rows: items.map(({ loan, f }) => {
            const p = person(loan.employee);
            return [
                loan.loanNumber, p.code, p.name, p.department, p.designation, loan.branch.name, f.loanAmount, f.totalRepayable, f.principalOutstanding,
                f.interestOutstanding, f.totalOutstanding, f.monthly, f.paid, f.remaining, f.nextDueMonth, f.status,
            ];
        }),
        totalCount: items.length,
        moneyColumns: [6, 7, 8, 9, 10, 11, 12],
        summary: [
            { label: 'Active Loans', value: items.length, money: false },
            { label: 'Total Loan Amount', value: sum(items.map(i => i.f.loanAmount)), money: true },
            { label: 'Principal Outstanding', value: sum(items.map(i => i.f.principalOutstanding)), money: true },
            { label: 'Interest Outstanding', value: sum(items.map(i => i.f.interestOutstanding)), money: true },
            { label: 'Total Outstanding', value: sum(items.map(i => i.f.totalOutstanding)), money: true },
        ],
    };
}

async function activeStaffAdvances(actor: StaffLoanActor, filters: StaffReportFilters): Promise<StaffReportResult> {
    const advances = await loadAdvances(actor, filters, 'ACTIVE');
    if (!advances) throw noAccess();
    const today = getKolkataCalendarYmd(new Date());
    const items = advances.map(advance => ({ advance, f: advanceFigures(advance, today) })).filter(({ f }) => statusMatches(f.status, filters.status));
    return {
        reportName: 'Active Staff Advance Report',
        // A Staff Advance carries no interest, so there is no interest column: total repayable = principal.
        headers: [
            'Advance Number', 'Employee ID', 'Employee Name', 'Department', 'Designation', 'Branch', 'Advance Amount', 'Total Repayable', 'Principal Outstanding',
            'Paid Amount', 'Remaining Installments', 'Monthly Repayment', 'Next Due Month', 'Status',
        ],
        rows: items.map(({ advance, f }) => {
            const p = person(advance.employee);
            return [
                advance.advanceNumber, p.code, p.name, p.department, p.designation, advance.branch.name, f.amount, f.amount, f.outstanding,
                f.paid, f.remaining, f.monthly, f.nextDueMonth, f.status,
            ];
        }),
        totalCount: items.length,
        moneyColumns: [6, 7, 8, 9, 11],
        summary: [
            { label: 'Active Advances', value: items.length, money: false },
            { label: 'Total Advance Amount', value: sum(items.map(i => i.f.amount)), money: true },
            { label: 'Principal Outstanding', value: sum(items.map(i => i.f.outstanding)), money: true },
        ],
    };
}

// ── schedule reports (list, then "View Schedule") ─────────────────────────

/** A closed (settled) loan's rows are all settled: the interest an early settlement waived is not owed any more. */
function loanScheduleRows(loan: LoanRecord): ScheduleRowView[] {
    const settled = loan.status === 'CLOSED';
    return computeRepayment(loan.schedules).schedules.map(s => ({
        installmentNo: s.installmentNo, month: formatMonthYear(s.dueDate), principal: s.principalDue, interest: s.interestDue, totalDue: s.totalDue,
        paid: s.totalPaid, outstanding: settled ? 0 : s.totalOutstanding, status: settled && s.status !== 'PAID' ? 'SETTLED' : s.status,
    }));
}

function advanceScheduleRows(advance: AdvanceRecord, today: string): ScheduleRowView[] {
    // No interest: an advance is interest-free, so Total Due equals Principal.
    return advanceRows(advance, today).map(s => ({
        installmentNo: s.installmentNo, month: formatMonthYear(s.dueDate), principal: s.due, interest: 0, totalDue: s.due,
        paid: s.paid, outstanding: s.outstanding, status: s.status,
    }));
}

const scheduleStatuses = {
    LOAN: ['ACTIVE', 'CLOSED'] as const,
    ADVANCE: ['ACTIVE', 'COMPLETED'] as const,
};
const pickStatuses = <T extends string>(allowed: readonly T[], wanted: string | undefined): T[] => {
    const only = allowed.find(status => status === wanted);
    return only ? [only] : [...allowed];
};

/** The loans / advances whose schedule can be opened, narrowed by the filters (status: ACTIVE, or CLOSED / COMPLETED). */
export async function listStaffSchedules(kind: ScheduleKind, actor: StaffLoanActor, filters: StaffReportFilters): Promise<ScheduleList> {
    const status = all(filters.status);
    let items: ScheduleListItem[];
    if (kind === 'LOAN') {
        const loans = await loadLoans(actor, filters, { in: pickStatuses(scheduleStatuses.LOAN, status) });
        if (!loans) throw noAccess();
        items = loans.map(loan => {
            const p = person(loan.employee);
            const rows = loanScheduleRows(loan);
            return {
                id: loan.id, number: loan.loanNumber, employeeCode: p.code, employeeName: p.name, department: p.department, designation: p.designation,
                branch: loan.branch.name, amount: Number(loan.approvedAmount ?? loan.requestedAmount), installments: rows.length, status: loan.status,
                totalOutstanding: sum(rows.map(r => r.outstanding)),
            };
        });
    } else {
        const advances = await loadAdvances(actor, filters, { in: pickStatuses(scheduleStatuses.ADVANCE, status) });
        if (!advances) throw noAccess();
        const today = getKolkataCalendarYmd(new Date());
        items = advances.map(advance => {
            const p = person(advance.employee);
            const rows = advanceScheduleRows(advance, today);
            return {
                id: advance.id, number: advance.advanceNumber, employeeCode: p.code, employeeName: p.name, department: p.department, designation: p.designation,
                branch: advance.branch.name, amount: Number(advance.amount), installments: rows.length, status: advance.status,
                totalOutstanding: sum(rows.map(r => r.outstanding)),
            };
        });
    }
    const noun = kind === 'LOAN' ? 'Loans' : 'Advances';
    return {
        items,
        summary: [
            { label: noun, value: items.length, money: false },
            { label: kind === 'LOAN' ? 'Total Loan Amount' : 'Total Advance Amount', value: sum(items.map(i => i.amount)), money: true },
            { label: 'Total Outstanding', value: sum(items.map(i => i.totalOutstanding)), money: true },
        ],
    };
}

/** One loan's / advance's repayment schedule. Scoped like the list, so an id outside the user's access is "not found". */
export async function getStaffScheduleDetail(kind: ScheduleKind, actor: StaffLoanActor, id: string): Promise<ScheduleDetail> {
    if (kind === 'LOAN') {
        const loans = await loadLoans(actor, { id }, { in: [...scheduleStatuses.LOAN] });
        if (!loans) throw noAccess();
        const loan = loans[0];
        if (!loan) throw new StaffLoanConfigurationError('Staff loan not found', 404);
        const p = person(loan.employee);
        const rate = Number(loan.annualInterestRate);
        return {
            kind, id: loan.id, number: loan.loanNumber, status: loan.status,
            employee: { code: p.code, name: p.name, department: p.department, designation: p.designation, branch: loan.branch.name },
            amount: Number(loan.approvedAmount ?? loan.requestedAmount),
            interestLabel: loan.interestType === 'INTEREST_FREE' ? 'Interest free' : `${loan.interestType === 'FLAT' ? 'Flat' : 'Monthly'} ${rate}%${loan.interestType === 'FLAT' ? ' p.a.' : ' p.m.'}`,
            tenureMonths: loan.tenureMonths, schedule: loanScheduleRows(loan),
        };
    }
    const advances = await loadAdvances(actor, { id }, { in: [...scheduleStatuses.ADVANCE] });
    if (!advances) throw noAccess();
    const advance = advances[0];
    if (!advance) throw new StaffLoanConfigurationError('Staff advance not found', 404);
    const p = person(advance.employee);
    return {
        kind, id: advance.id, number: advance.advanceNumber, status: advance.status,
        employee: { code: p.code, name: p.name, department: p.department, designation: p.designation, branch: advance.branch.name },
        amount: Number(advance.amount), interestLabel: null, tenureMonths: advance.repaymentMonths,
        schedule: advanceScheduleRows(advance, getKolkataCalendarYmd(new Date())),
    };
}

// ── closure reports ───────────────────────────────────────────────────────

/** Closed-date range (inclusive, IST calendar days) as a DateTime filter, or none. */
function closedBetween(filters: StaffReportFilters): { gte?: Date; lte?: Date } | undefined {
    if (!filters.fromDate && !filters.toDate) return undefined;
    const dayMs = 24 * 60 * 60 * 1000;
    return {
        ...(filters.fromDate ? { gte: new Date(`${filters.fromDate}T00:00:00+05:30`) } : {}),
        ...(filters.toDate ? { lte: new Date(new Date(`${filters.toDate}T00:00:00+05:30`).getTime() + dayMs - 1) } : {}),
    };
}

const istDay = (date: Date | null) => (date ? formatDayMonthYear(getKolkataCalendarYmd(date)) : '');
const paymentLabel = (mode: string | null | undefined) => (mode === 'BANK_TRANSFER' ? 'Bank Transfer' : mode === 'CASH' ? 'Cash' : mode ?? '');
const CLOSURE_TYPES = { EARLY: 'Early Settlement', REGULAR: 'Regular Repayment', SALARY: 'Salary Deduction' } as const;

/** Loans that are CLOSED: settled early (an EARLY_SETTLEMENT transaction exists) or repaid to the last installment. */
async function staffLoanClosure(actor: StaffLoanActor, filters: StaffReportFilters): Promise<StaffReportResult> {
    const scope = loanScope(actor);
    if (!scope) throw noAccess();
    checkBranch(actor, filters.branchId);
    const closedAt = closedBetween(filters);
    const loans = await prisma.staffLoan.findMany({
        where: { AND: [scope, { status: 'CLOSED', ...(closedAt ? { closedAt } : {}) }, commonWhere(filters, 'loanNumber')] },
        include: {
            ...loanInclude,
            transactions: {
                where: { type: 'EARLY_SETTLEMENT', status: 'POSTED' },
                select: { paymentMode: true, reference: true, createdBy: { select: { firstName: true, lastName: true } } },
            },
        },
        orderBy: [{ closedAt: 'desc' }, { loanNumber: 'asc' }],
    });

    const wanted = all(filters.status);
    const items = loans.map(loan => {
        const f = loanFigures(loan);
        const settlement = loan.transactions[0];
        return { loan, f, settlement, type: settlement ? CLOSURE_TYPES.EARLY : CLOSURE_TYPES.REGULAR, waived: Math.max(0, round2(f.totalRepayable - f.paid)) };
    }).filter(i => !wanted || (wanted === 'EARLY_SETTLEMENT' ? i.settlement : !i.settlement));

    return {
        reportName: 'Staff Loan Closure Report',
        headers: [
            'Loan Number', 'Employee ID', 'Employee Name', 'Department', 'Designation', 'Branch', 'Loan Amount', 'Total Repayable', 'Total Paid',
            'Interest Waived', 'Disbursed On', 'Closed On', 'Closure Type', 'Payment Method', 'Reference', 'Settled By',
        ],
        rows: items.map(({ loan, f, settlement, type, waived }) => {
            const p = person(loan.employee);
            return [
                loan.loanNumber, p.code, p.name, p.department, p.designation, loan.branch.name, f.loanAmount, f.totalRepayable, f.paid, waived,
                istDay(loan.disbursedAt), istDay(loan.closedAt), type, paymentLabel(settlement?.paymentMode), settlement?.reference ?? '',
                settlement ? `${settlement.createdBy.firstName} ${settlement.createdBy.lastName}`.trim() : '',
            ];
        }),
        totalCount: items.length,
        moneyColumns: [6, 7, 8, 9],
        summary: [
            { label: 'Closed Loans', value: items.length, money: false },
            { label: 'Early Settlements', value: items.filter(i => i.settlement).length, money: false },
            { label: 'Total Loan Amount', value: sum(items.map(i => i.f.loanAmount)), money: true },
            { label: 'Total Paid', value: sum(items.map(i => i.f.paid)), money: true },
            { label: 'Interest Waived', value: sum(items.map(i => i.waived)), money: true },
        ],
    };
}

/**
 * Advances that are COMPLETED: settled early (a posted transaction paid directly, not through payroll) or repaid
 * through salary deductions. A Staff Advance carries no interest, so there is nothing to waive.
 */
async function staffAdvanceClosure(actor: StaffLoanActor, filters: StaffReportFilters): Promise<StaffReportResult> {
    const scope = advanceScope(actor);
    if (!scope) throw noAccess();
    checkBranch(actor, filters.branchId);
    const completedAt = closedBetween(filters);
    const advances = await prisma.staffAdvance.findMany({
        where: { AND: [scope, { status: 'COMPLETED', ...(completedAt ? { completedAt } : {}) }, commonWhere(filters, 'advanceNumber')] },
        include: {
            ...advanceInclude,
            transactions: {
                where: { status: 'POSTED', salaryPayRecordId: null, paymentMode: { not: null } },
                select: { paymentMode: true, reference: true, createdBy: { select: { firstName: true, lastName: true } } },
            },
        },
        orderBy: [{ completedAt: 'desc' }, { advanceNumber: 'asc' }],
    });

    const today = getKolkataCalendarYmd(new Date());
    const wanted = all(filters.status);
    const items = advances.map(advance => {
        const settlement = advance.transactions[0];
        return { advance, f: advanceFigures(advance, today), settlement, type: settlement ? CLOSURE_TYPES.EARLY : CLOSURE_TYPES.SALARY };
    }).filter(i => !wanted || (wanted === 'EARLY_SETTLEMENT' ? i.settlement : !i.settlement));

    return {
        reportName: 'Staff Advance Closure Report',
        headers: [
            'Advance Number', 'Employee ID', 'Employee Name', 'Department', 'Designation', 'Branch', 'Advance Amount', 'Total Paid',
            'Disbursed On', 'Closed On', 'Closure Type', 'Payment Method', 'Reference', 'Settled By',
        ],
        rows: items.map(({ advance, f, settlement, type }) => {
            const p = person(advance.employee);
            return [
                advance.advanceNumber, p.code, p.name, p.department, p.designation, advance.branch.name, f.amount, f.paid,
                istDay(advance.disbursedAt), istDay(advance.completedAt), type, paymentLabel(settlement?.paymentMode), settlement?.reference ?? '',
                settlement ? `${settlement.createdBy.firstName} ${settlement.createdBy.lastName}`.trim() : '',
            ];
        }),
        totalCount: items.length,
        moneyColumns: [6, 7],
        summary: [
            { label: 'Closed Advances', value: items.length, money: false },
            { label: 'Early Settlements', value: items.filter(i => i.settlement).length, money: false },
            { label: 'Total Advance Amount', value: sum(items.map(i => i.f.amount)), money: true },
            { label: 'Total Paid', value: sum(items.map(i => i.f.paid)), money: true },
        ],
    };
}

async function staffOutstanding(actor: StaffLoanActor, filters: StaffReportFilters): Promise<StaffReportResult> {
    const includeLoans = filters.type !== 'ADVANCE';
    const includeAdvances = filters.type !== 'LOAN';
    const today = getKolkataCalendarYmd(new Date());
    const [loans, advances] = await Promise.all([
        includeLoans ? loadLoans(actor, filters, 'ACTIVE') : Promise.resolve([] as LoanRecord[]),
        includeAdvances ? loadAdvances(actor, filters, 'ACTIVE') : Promise.resolve([] as AdvanceRecord[]),
    ]);
    if (loans === null && advances === null) throw noAccess();
    if ((includeLoans && !includeAdvances && loans === null) || (includeAdvances && !includeLoans && advances === null)) throw noAccess();

    // One row per employee, however many loans / advances they hold: nothing is counted twice.
    type Line = { id: string; p: ReturnType<typeof person>; branch: string; loanP: number; loanI: number; advP: number };
    const byEmployee = new Map<string, Line>();
    const line = (employee: Person): Line => {
        let existing = byEmployee.get(employee.id);
        if (!existing) {
            existing = { id: employee.id, p: person(employee), branch: employee.branch?.name ?? '', loanP: 0, loanI: 0, advP: 0 };
            byEmployee.set(employee.id, existing);
        }
        return existing;
    };
    for (const loan of loans ?? []) {
        const f = loanFigures(loan);
        const l = line(loan.employee);
        l.loanP = round2(l.loanP + f.principalOutstanding);
        l.loanI = round2(l.loanI + f.interestOutstanding);
    }
    for (const advance of advances ?? []) {
        const l = line(advance.employee);
        l.advP = round2(l.advP + advanceFigures(advance, today).outstanding);
    }

    const lines = [...byEmployee.values()].sort((a, b) => a.p.name.localeCompare(b.p.name));

    // Salary picture from the existing payroll calculation (the same one the loan / advance screens use). An
    // employee whose payroll cannot be computed (e.g. no salary set-up) just gets blank salary cells.
    const salaries = await mapLimit(lines, SALARY_CONCURRENCY, async l => {
        try { return await getAdvanceSalarySummary(l.id); } catch { return null; }
    });
    const rows = lines.map((l, i) => {
        const salary = salaries[i];
        return [
            l.p.code, l.p.name, l.p.department, l.branch,
            round2(l.loanP + l.loanI), l.loanP, l.loanI,
            l.advP, l.advP, 0,
            round2(l.loanP + l.advP), l.loanI, round2(l.loanP + l.loanI + l.advP),
            salary ? salary.grossSalary : '', salary ? salary.otherDeductions : '', salary ? salary.existingLoanDeduction : '',
            salary ? salary.existingAdvanceDeduction : '', salary ? salary.currentInHand : '',
            // In-hand once the staff loan and staff advance deductions are no longer taken from the salary.
            salary ? round2(salary.currentInHand + salary.existingLoanDeduction + salary.existingAdvanceDeduction) : '',
        ];
    });
    const loanPrincipal = sum(lines.map(l => l.loanP));
    const loanInterest = sum(lines.map(l => l.loanI));
    const advance = sum(lines.map(l => l.advP));
    return {
        reportName: 'Total Staff Outstanding Report',
        headers: [
            'Employee ID', 'Employee', 'Department', 'Branch',
            'Staff Loan Outstanding', 'Loan Principal', 'Loan Interest',
            'Staff Advance Outstanding', 'Advance Principal', 'Advance Interest',
            'Total Principal', 'Total Interest', 'Total Outstanding',
            'Current Salary', 'Other Deductions', 'Staff Loan Deduction', 'Staff Advance Deduction', 'Current In-Hand Salary', 'Expected In-Hand (No Staff Deductions)',
        ],
        rows, totalCount: rows.length, moneyColumns: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
        summary: [
            { label: 'Total Staff Loan Outstanding', value: round2(loanPrincipal + loanInterest), money: true },
            { label: 'Total Staff Loan Principal', value: loanPrincipal, money: true },
            { label: 'Total Staff Loan Interest', value: loanInterest, money: true },
            { label: 'Total Staff Advance Outstanding', value: advance, money: true },
            { label: 'Total Staff Principal Outstanding', value: round2(loanPrincipal + advance), money: true },
            { label: 'Total Staff Outstanding', value: round2(loanPrincipal + loanInterest + advance), money: true },
        ],
    };
}

export async function runStaffReport(slug: StaffReportSlug, actor: StaffLoanActor, filters: StaffReportFilters): Promise<StaffReportResult> {
    switch (slug) {
        case 'active-staff-loans': return activeStaffLoans(actor, filters);
        case 'active-staff-advances': return activeStaffAdvances(actor, filters);
        case 'staff-loan-closure': return staffLoanClosure(actor, filters);
        case 'staff-advance-closure': return staffAdvanceClosure(actor, filters);
        case 'staff-outstanding': return staffOutstanding(actor, filters);
    }
}
