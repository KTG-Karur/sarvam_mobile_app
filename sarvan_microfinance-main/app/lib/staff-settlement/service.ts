import { Prisma } from '@prisma/client';
import { prisma } from '@/app/lib/db';
import { getKolkataCalendarYmd } from '@/app/lib/branch-lock';
import { StaffLoanConfigurationError } from '@/app/lib/staff-loans/configuration-service';
import { resolveMasterCapabilities, type MasterCapabilities } from '@/app/lib/staff-loans/configuration';
import type { StaffLoanActor } from '@/app/lib/staff-loans/application-access';
import { computeRepayment, recordEarlySettlement } from '@/app/lib/staff-loans/application-service';
import { getSalaryRecoveryDue } from '@/app/lib/staff-loans/salary-recovery';
import { getAdvanceRecoveryDue } from '@/app/lib/staff-advances/salary-recovery';
import { getAdvanceSalarySummary } from '@/app/lib/staff-advances/salary';
import { settleAdvance } from '@/app/lib/staff-advances/settlement';
import { formatMonthYear } from './format';
import {
    LEGACY_LOAN_REPAYMENTS_PAGE, STAFF_SETTLEMENT_PAGE, staffSettlementSchema,
    type SettlementCapabilities, type SettlementDetail, type SettlementKind, type SettlementListItem, type SettlementSalary,
    type SettlementListFilters, type SettlementScheduleRow, type StaffSettlementInput,
} from './settlement';

const LIST_LIMIT = 50;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const dec = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const isoDay = (date: Date) => date.toISOString().split('T')[0];

// ── access ────────────────────────────────────────────────────────────────

/** Branches a settlement capability covers: everything the actor's branch access allows (null), or a subset. */
type BranchScope = { branchIds: string[] | null };

/**
 * Where this actor holds a settlement capability, on top of their branch access. An admin holds every capability;
 * everyone else needs a page grant on the Settlement page (Staff Loan settlement also honours the retired
 * Repayments page grant), limited to the branch of the role assignment that carries it. Null = no access at all.
 */
function settlementScope(actor: StaffLoanActor, kind: SettlementKind, capability: keyof MasterCapabilities): BranchScope | null {
    if (actor.isAdmin) return { branchIds: actor.branchIds };
    const pages = kind === 'LOAN' ? [STAFF_SETTLEMENT_PAGE, LEGACY_LOAN_REPAYMENTS_PAGE] : [STAFF_SETTLEMENT_PAGE];
    const grants = actor.assignments.filter(a => pages.some(page => resolveMasterCapabilities(false, [a.pagePermissions], page)[capability]));
    if (!grants.length) return null;
    if (grants.some(g => g.branchId === null)) return { branchIds: actor.branchIds };
    const granted = [...new Set(grants.map(g => g.branchId as string))];
    return { branchIds: actor.branchIds === null ? granted : granted.filter(id => actor.branchIds!.includes(id)) };
}

const branchWhere = (scope: BranchScope) => (scope.branchIds === null ? {} : { branchId: { in: scope.branchIds } });

export function settlementCapabilities(actor: StaffLoanActor): SettlementCapabilities {
    const has = (kind: SettlementKind, capability: keyof MasterCapabilities) => settlementScope(actor, kind, capability) !== null;
    return {
        loan: { view: has('LOAN', 'view'), settle: has('LOAN', 'add') },
        advance: { view: has('ADVANCE', 'view'), settle: has('ADVANCE', 'add') },
    };
}

function requireScope(actor: StaffLoanActor, kind: SettlementKind, capability: keyof MasterCapabilities): BranchScope {
    const scope = settlementScope(actor, kind, capability);
    if (!scope) {
        throw new StaffLoanConfigurationError(
            `You do not have permission to ${capability === 'view' ? 'view' : 'settle'} Staff ${kind === 'LOAN' ? 'Loans' : 'Advances'} here.`, 403,
        );
    }
    return scope;
}

// ── shared shaping ────────────────────────────────────────────────────────

const employeeSelect = {
    id: true, firstName: true, lastName: true, employeeId: true, role: true,
    department: { select: { name: true } }, designation: { select: { name: true } },
} satisfies Prisma.UserSelect;
type EmployeeRecord = Prisma.UserGetPayload<{ select: typeof employeeSelect }>;

const employeeView = (e: EmployeeRecord, branch: string) => ({
    id: e.id, name: `${e.firstName} ${e.lastName}`.trim(), code: e.employeeId, department: e.department?.name ?? null,
    designation: e.designation?.name ?? e.role, branch,
});

const searchWhere = (search: string | undefined) => {
    const term = search?.trim();
    return term ? [
        { employee: { firstName: { contains: term, mode: 'insensitive' as const } } },
        { employee: { lastName: { contains: term, mode: 'insensitive' as const } } },
        { employee: { employeeId: { contains: term, mode: 'insensitive' as const } } },
    ] : null;
};

async function salaryFor(employeeId: string, kind: SettlementKind, obligationId: string): Promise<SettlementSalary | null> {
    try {
        const salary = await getAdvanceSalarySummary(employeeId);
        // What payroll would deduct this month for this very loan/advance (the existing due-amount logic).
        const due = kind === 'LOAN'
            ? (await getSalaryRecoveryDue(employeeId, salary.month, salary.year)).breakdown.filter(b => b.loanId === obligationId).reduce((sum, b) => sum + b.amount, 0)
            : (await getAdvanceRecoveryDue(employeeId, salary.month, salary.year)).breakdown.filter(b => b.advanceId === obligationId).reduce((sum, b) => sum + b.amount, 0);
        return {
            month: salary.month, year: salary.year, currentSalary: salary.grossSalary, otherDeductions: salary.otherDeductions,
            existingLoanDeduction: salary.existingLoanDeduction, existingAdvanceDeduction: salary.existingAdvanceDeduction,
            totalDeductions: salary.totalDeductions, currentInHand: salary.currentInHand,
            thisObligationDeduction: round2(due), expectedInHand: round2(salary.currentInHand + due),
        };
    } catch {
        // An employee without salary set-up must not block a settlement; the salary card is simply omitted.
        return null;
    }
}

// ── list ──────────────────────────────────────────────────────────────────

/** Employee-side filters (role, department) shared by the loan and advance lists. */
const employeeWhere = (filters: SettlementListFilters) => {
    const employee = {
        ...(filters.role ? { role: filters.role } : {}),
        ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
    };
    return Object.keys(employee).length ? { employee } : {};
};

/** A chosen branch must sit inside what this capability covers; the list is then narrowed to it. */
function selectedBranchWhere(scope: BranchScope, branchId: string | undefined) {
    if (!branchId) return branchWhere(scope);
    if (scope.branchIds !== null && !scope.branchIds.includes(branchId)) {
        throw new StaffLoanConfigurationError('You do not have access to this branch.', 403);
    }
    return { branchId };
}

export async function listSettlementCandidates(actor: StaffLoanActor, kind: SettlementKind, filters: SettlementListFilters = {}): Promise<SettlementListItem[]> {
    const scope = requireScope(actor, kind, 'view');
    const search = filters.search;
    const or = searchWhere(search);
    const where = { status: 'ACTIVE' as const, ...selectedBranchWhere(scope, filters.branchId), ...employeeWhere(filters) };

    if (kind === 'LOAN') {
        const term = search?.trim();
        const rows = await prisma.staffLoan.findMany({
            where: {
                ...where,
                ...(term ? { OR: [{ loanNumber: { contains: term, mode: 'insensitive' as const } }, ...(or ?? [])] } : {}),
            },
            include: {
                employee: { select: employeeSelect }, branch: { select: { name: true } },
                schedules: { include: { allocations: { where: { transaction: { status: 'POSTED' } }, select: { principal: true, interest: true } } } },
            },
            orderBy: { disbursedAt: 'desc' }, take: LIST_LIMIT,
        });
        return rows.map(r => {
            const totalDue = r.schedules.reduce((sum, s) => sum.plus(s.principalDue).plus(s.interestDue), dec(0));
            const totalPaid = r.schedules.reduce((sum, s) => s.allocations.reduce((inner, a) => inner.plus(a.principal).plus(a.interest), sum), dec(0));
            return {
                id: r.id, number: r.loanNumber, employeeName: `${r.employee.firstName} ${r.employee.lastName}`.trim(), employeeCode: r.employee.employeeId,
                department: r.employee.department?.name ?? null, branchName: r.branch.name, totalOutstanding: Prisma.Decimal.max(0, totalDue.minus(totalPaid)).toNumber(),
            };
        });
    }

    const term = search?.trim();
    const rows = await prisma.staffAdvance.findMany({
        where: {
            ...where,
            ...(term ? { OR: [{ advanceNumber:{ contains: term, mode: 'insensitive' as const } }, ...(or ?? [])] } : {}),
        },
        include: {
            employee: { select: employeeSelect }, branch: { select: { name: true } },
            schedules: { include: { allocations: { where: { transaction: { status: 'POSTED' } }, select: { amount: true } } } },
        },
        orderBy: { disbursedAt: 'desc' }, take: LIST_LIMIT,
    });
    return rows.map(r => {
        const totalDue = r.schedules.reduce((sum, s) => sum.plus(s.amountDue), dec(0));
        const totalPaid = r.schedules.reduce((sum, s) => s.allocations.reduce((inner, a) => inner.plus(a.amount), sum), dec(0));
        return {
            id: r.id, number: r.advanceNumber, employeeName: `${r.employee.firstName} ${r.employee.lastName}`.trim(), employeeCode: r.employee.employeeId,
            department: r.employee.department?.name ?? null, branchName: r.branch.name, totalOutstanding: Prisma.Decimal.max(0, totalDue.minus(totalPaid)).toNumber(),
        };
    });
}

// ── detail ────────────────────────────────────────────────────────────────

const PENDING_PAYROLL = 'A payroll deduction is submitted but not marked paid yet. Mark that payroll as paid (or clear it) before settling.';
const SELF_SETTLEMENT = 'You cannot settle your own staff loan or advance.';

export async function getSettlementDetail(actor: StaffLoanActor, kind: SettlementKind, id: string): Promise<SettlementDetail> {
    const viewScope = requireScope(actor, kind, 'view');
    const canSettleHere = settlementScope(actor, kind, 'add');
    const today = getKolkataCalendarYmd(new Date());

    if (kind === 'LOAN') {
        const loan = await prisma.staffLoan.findFirst({
            where: { id, status: 'ACTIVE', ...branchWhere(viewScope) },
            include: {
                employee: { select: employeeSelect }, branch: { select: { name: true } },
                transactions: { where: { status: 'PENDING' }, select: { id: true } },
                schedules: {
                    orderBy: { installmentNo: 'asc' },
                    include: { allocations: { where: { transaction: { status: 'POSTED' } }, select: { principal: true, interest: true, transaction: { select: { transactionDate: true } } } } },
                },
            },
        });
        if (!loan) throw new StaffLoanConfigurationError('Active staff loan not found', 404);

        const r = computeRepayment(loan.schedules);
        const paidInstallments = r.schedules.filter(s => s.status === 'PAID').length;
        const blockedReason = loan.transactions.length ? PENDING_PAYROLL : loan.employeeId === actor.userId ? SELF_SETTLEMENT : null;
        return {
            type: 'LOAN', id: loan.id, number: loan.loanNumber, version: loan.version,
            employee: employeeView(loan.employee, loan.branch.name), branchName: loan.branch.name,
            originalAmount: Number(loan.approvedAmount ?? loan.requestedAmount),
            totalRepayable: r.totalPrincipalDue.plus(r.totalInterestDue).toNumber(),
            principalOutstanding: r.principalOutstanding.toNumber(), interestOutstanding: r.interestOutstanding.toNumber(), totalOutstanding: r.totalOutstanding.toNumber(),
            paidAmount: r.totalPrincipalPaid.plus(r.totalInterestPaid).toNumber(),
            totalInstallments: loan.schedules.length, remainingInstallments: loan.schedules.length - paidInstallments,
            settlement: {
                amount: r.principalOutstanding.plus(r.settlementPayableInterest).toNumber(), principal: r.principalOutstanding.toNumber(),
                interest: r.settlementPayableInterest.toNumber(), waivedInterest: r.settlementWaivedInterest.toNumber(), settlementDate: today,
            },
            schedule: r.schedules.map((s): SettlementScheduleRow => ({
                installmentNo: s.installmentNo, month: formatMonthYear(s.dueDate), principal: s.principalDue, interest: s.interestDue, totalDue: s.totalDue,
                paid: s.totalPaid, outstanding: s.totalOutstanding, status: s.status,
            })),
            salary: await salaryFor(loan.employeeId, 'LOAN', loan.id),
            blockedReason, canSettle: canSettleHere !== null && blockedReason === null,
        };
    }

    const advance = await prisma.staffAdvance.findFirst({
        where: { id, status: 'ACTIVE', ...branchWhere(viewScope) },
        include: {
            employee: { select: employeeSelect }, branch: { select: { name: true } },
            transactions: { where: { status: 'PENDING' }, select: { id: true } },
            schedules: { orderBy: { installmentNo: 'asc' }, include: { allocations: { where: { transaction: { status: 'POSTED' } }, select: { amount: true } } } },
        },
    });
    if (!advance) throw new StaffLoanConfigurationError('Active staff advance not found', 404);

    const schedule = advance.schedules.map((s): SettlementScheduleRow => {
        const due = dec(s.amountDue);
        const paid = s.allocations.reduce((sum, a) => sum.plus(a.amount), dec(0));
        const outstanding = Prisma.Decimal.max(0, due.minus(paid));
        return {
            installmentNo: s.installmentNo, month: formatMonthYear(isoDay(s.dueDate)), principal: due.toNumber(), interest: 0, totalDue: due.toNumber(),
            paid: paid.toNumber(), outstanding: outstanding.toNumber(),
            status: outstanding.lessThanOrEqualTo(0.001) ? 'PAID' : paid.greaterThan(0) ? 'PARTIAL' : isoDay(s.dueDate) < today ? 'OVERDUE' : 'PENDING',
        };
    });
    const outstanding = round2(schedule.reduce((sum, s) => sum + s.outstanding, 0));
    const paidAmount = round2(schedule.reduce((sum, s) => sum + s.paid, 0));
    const blockedReason = advance.transactions.length ? PENDING_PAYROLL : advance.employeeId === actor.userId ? SELF_SETTLEMENT : null;
    return {
        type: 'ADVANCE', id: advance.id, number: advance.advanceNumber, version: advance.version,
        employee: employeeView(advance.employee, advance.branch.name), branchName: advance.branch.name,
        originalAmount: Number(advance.amount), totalRepayable: Number(advance.amount),
        principalOutstanding: outstanding, interestOutstanding: 0, totalOutstanding: outstanding, paidAmount,
        totalInstallments: schedule.length, remainingInstallments: schedule.filter(s => s.status !== 'PAID').length,
        settlement: { amount: outstanding, principal: outstanding, interest: 0, waivedInterest: 0, settlementDate: today },
        schedule, salary: await salaryFor(advance.employeeId, 'ADVANCE', advance.id),
        blockedReason, canSettle: canSettleHere !== null && blockedReason === null,
    };
}

// ── settle ────────────────────────────────────────────────────────────────

/**
 * Validates who may settle what, then hands over to the loan or advance settlement. The route never trusts an
 * amount or a date from the caller: both are derived server-side inside the settlement transaction.
 */
export async function submitSettlement(actor: StaffLoanActor, input: StaffSettlementInput) {
    const data = staffSettlementSchema.parse(input);
    const scope = requireScope(actor, data.type, 'add');

    // The target must exist, be ACTIVE and sit inside the branches this settlement permission covers.
    const target = data.type === 'LOAN'
        ? await prisma.staffLoan.findFirst({ where: { id: data.id, ...branchWhere(scope) }, select: { employeeId: true } })
        : await prisma.staffAdvance.findFirst({ where: { id: data.id, ...branchWhere(scope) }, select: { employeeId: true } });
    if (!target) throw new StaffLoanConfigurationError(`Staff ${data.type === 'LOAN' ? 'loan' : 'advance'} not found`, 404);
    if (target.employeeId === actor.userId) throw new StaffLoanConfigurationError(SELF_SETTLEMENT, 403);

    const common = {
        paymentMode: data.paymentMode, reference: data.reference ?? null, remarks: data.remarks ?? null,
        expectedVersion: data.expectedVersion, expectedAmount: data.expectedAmount,
    };
    if (data.type === 'LOAN') {
        const result = await recordEarlySettlement({ loanId: data.id, settlementDate: getKolkataCalendarYmd(new Date()), ...common }, actor);
        return { type: 'LOAN' as const, number: result.loanNumber, transactionId: result.transactionId, settlementAmount: result.settlementAmount, waivedInterest: result.waivedInterest };
    }
    const result = await settleAdvance(actor, { advanceId: data.id, ...common });
    return { type: 'ADVANCE' as const, number: result.advanceNumber, transactionId: result.transactionId, settlementAmount: result.settlementAmount, waivedInterest: 0 };
}
