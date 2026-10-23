import { Prisma } from '@prisma/client';
import { prisma } from '@/app/lib/db';
import { getKolkataCalendarYmd } from '@/app/lib/branch-lock';
import { getKolkataMonthBounds } from '@/app/lib/attendance-leave-permission';
import { StaffLoanConfigurationError } from '@/app/lib/staff-loans/configuration-service';
import { actorRoleCanAct, type StaffLoanActor } from '@/app/lib/staff-loans/application-access';
import { loadEmployeeProfile } from '@/app/lib/staff-loans/application-service';
import { STAFF_LOAN_DOCUMENT_ALLOWED_MIME } from '@/app/lib/staff-loans/document-rule';
import { isStaffLoanDocumentKeyFor, readStaffLoanDocument } from '@/app/lib/storage/staff-loan-document-storage';
import { getSignedReadUrl } from '@/app/lib/storage/gcs-client';
import { buildSalaryDueDates, defaultFirstDueMonth, isValidSalaryDay, type FirstDueMonth } from '@/app/lib/staff-loans/salary-schedule';
import type { EmployeeOption } from '@/app/lib/staff-loans/application';
import {
    ADVANCE_MANAGEMENT_PAGE, ADVANCE_REPAYMENT_MONTHS,
    advanceApplicationSchema, advanceEditSchema, advanceReviewSchema, advanceCancelSchema, advanceDisburseSchema,
    formatStaffAdvanceNumber, projectInHand, splitAdvanceInstallments,
    type AdvanceApplicationInput, type AdvanceCapabilities, type AdvanceDetail, type AdvanceEditInput, type AdvanceList,
    type AdvanceOptions, type AdvanceRow, type AdvanceSalarySummary, type AdvanceScheduleRow, type AdvanceStatus, type AdvanceSummaryCards,
} from './advance';
import { advanceCanApplyForOthers, advancePageScope, advanceRoleScope, isUnrestricted } from './access';
import { getAdvanceSalarySummary, loadObligations } from './salary';

const PAGE_SIZE = 20;
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const dec = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const isoDay = (date: Date) => date.toISOString().split('T')[0];

const workflowInclude = {
    stages: { orderBy: { levelOrder: 'asc' as const }, include: { role: { select: { name: true, isActive: true } } } },
    disbursementRoles: { select: { id: true, isActive: true } },
} satisfies Prisma.StaffLoanWorkflowConfigInclude;

const advanceInclude = {
    employee: { select: { firstName: true, lastName: true, employeeId: true, role: true, department: { select: { name: true } }, designation: { select: { name: true } } } },
    branch: { select: { name: true } },
    workflowConfig: { include: workflowInclude },
    schedules: {
        orderBy: { installmentNo: 'asc' as const },
        include: { allocations: { where: { transaction: { status: 'POSTED' as const } }, select: { amount: true, transaction: { select: { postedAt: true } } } } },
    },
} satisfies Prisma.StaffAdvanceInclude;
type AdvanceRecord = Prisma.StaffAdvanceGetPayload<{ include: typeof advanceInclude }>;

type Snapshot = { currentInHand: number; projectedInHand: number };

// ── row shaping ───────────────────────────────────────────────────────────

function scheduleRows(row: AdvanceRecord, today: string): AdvanceScheduleRow[] {
    return row.schedules.map(s => {
        const due = dec(s.amountDue);
        const paid = s.allocations.reduce((sum, a) => sum.plus(a.amount), dec(0));
        const outstanding = Prisma.Decimal.max(0, due.minus(paid));
        const dueDate = isoDay(s.dueDate);
        const paidOn = s.allocations.map(a => a.transaction.postedAt).filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0];
        const isPaid = outstanding.lessThanOrEqualTo(0.001);
        return {
            id: s.id, installmentNo: s.installmentNo, dueDate,
            principal: due.toNumber(), interest: 0, totalDue: due.toNumber(),
            paidAmount: paid.toNumber(), paymentDate: paidOn ? getKolkataCalendarYmd(paidOn) : null,
            outstanding: outstanding.toNumber(),
            status: isPaid ? 'PAID' : paid.greaterThan(0) ? 'PARTIAL' : dueDate < today ? 'OVERDUE' : 'PENDING',
        };
    });
}

// The stage this actor may act on for an advance under review, or null. Same rule as the Staff Loan review:
// the current-stage role within the advance's branch, never the applicant (and never an admin by role alone).
function reviewerStage(row: AdvanceRecord, actor: StaffLoanActor) {
    const stage = row.workflowConfig?.stages.find(s => s.levelOrder === row.currentApprovalLevel);
    if (row.status !== 'SUBMITTED' || !stage || !stage.role.isActive || row.employeeId === actor.userId) return null;
    return actorRoleCanAct(actor, stage.roleId, row.branchId) ? stage : null;
}

// May this actor pay out an approved advance? A disbursement-authority role of the advance's workflow (or an
// admin), never the applicant.
function canDisburseAdvance(row: AdvanceRecord, actor: StaffLoanActor) {
    if (row.status !== 'APPROVED' || row.employeeId === actor.userId) return false;
    if (actor.isAdmin) return true;
    return (row.workflowConfig?.disbursementRoles ?? []).some(r => r.isActive && actorRoleCanAct(actor, r.id, row.branchId));
}

function toRow(row: AdvanceRecord, actor: StaffLoanActor, today: string): AdvanceRow {
    const amount = Number(row.amount);
    const schedule = scheduleRows(row, today);
    // Money is only owed once the advance has been paid out.
    const approved = row.status === 'ACTIVE' || row.status === 'COMPLETED';
    const paidAmount = round2(schedule.reduce((sum, s) => sum + s.paidAmount, 0));
    const paidInstallments = schedule.filter(s => s.status === 'PAID').length;
    const snapshot = row.salarySnapshot as Snapshot | null;
    return {
        id: row.id, advanceNumber: row.advanceNumber, employeeId: row.employeeId, employeeCode: row.employee.employeeId,
        employeeName: `${row.employee.firstName} ${row.employee.lastName}`.trim(),
        department: row.employee.department?.name ?? null, designation: row.employee.designation?.name ?? row.employee.role,
        branchName: row.branch.name, status: row.status, amount, totalRepayable: amount, paidAmount,
        outstandingAmount: approved ? round2(amount - paidAmount) : null,
        monthlyRepayment: schedule[0] ? schedule[0].totalDue : splitAdvanceInstallments(amount, row.repaymentMonths)[0],
        repaymentMonths: row.repaymentMonths, paidInstallments,
        remainingInstallments: approved ? row.repaymentMonths - paidInstallments : row.status === 'SUBMITTED' || row.status === 'APPROVED' ? row.repaymentMonths : 0,
        purpose: row.purpose, remarks: row.remarks ?? '',
        document: row.documentKey ? { fileName: row.documentName ?? 'Document', mimeType: row.documentMimeType ?? '', fileSize: row.documentSize ?? 0 } : null,
        currentInHand: snapshot?.currentInHand ?? null, projectedInHand: snapshot?.projectedInHand ?? null,
        currentStage: row.workflowConfig?.stages.find(s => s.levelOrder === row.currentApprovalLevel)?.stageName ?? null,
        canReview: !!reviewerStage(row, actor), canDisburse: canDisburseAdvance(row, actor), version: row.version,
        createdAt: row.createdAt.toISOString(),
        approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
        disbursedAt: row.disbursedAt ? row.disbursedAt.toISOString() : null,
        completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    };
}

async function nextAdvanceNumber(tx: Prisma.TransactionClient) {
    const rows = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('staff_advance_number_seq') AS n`;
    return formatStaffAdvanceNumber(rows[0].n);
}

// A staff advance follows the SAME salary date as staff loans: the one set on the Staff Loan approval workflow
// (the payroll date is company-wide). Null until an admin sets it.
async function loanSalaryDay(db: Prisma.TransactionClient | typeof prisma): Promise<number | null> {
    const config = await db.staffLoanWorkflowConfig.findFirst({ where: { kind: 'LOAN' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { salaryDay: true } });
    return isValidSalaryDay(config?.salaryDay) ? config.salaryDay : null;
}

// The installment due dates (one per repayment month), by exactly the staff loan rules: each falls on the salary
// day of its month (a Sunday moves to the day before, short months use the last day), starting this month or next
// month. Without a salary date the first due date is entered manually and each next one falls a month later
// (legacy behaviour).
async function plannedDueDates(
    db: Prisma.TransactionClient | typeof prisma, disbursementYmd: string, months: number,
    options: { firstDueMonth?: FirstDueMonth; firstDueDate?: string } = {},
) {
    const salaryDay = await loanSalaryDay(db);
    if (salaryDay !== null) {
        const dates = buildSalaryDueDates(disbursementYmd, options.firstDueMonth ?? 'NEXT_MONTH', salaryDay, months);
        if (dates[0] < disbursementYmd) {
            throw new StaffLoanConfigurationError('The salary date for this month has already passed. Choose "Next month" for the first due date.');
        }
        return dates;
    }
    if (!options.firstDueDate) throw new StaffLoanConfigurationError('Enter the first due date.');
    return Array.from({ length: months }, (_, i) => {
        const dueDate = new Date(options.firstDueDate as string);
        dueDate.setMonth(dueDate.getMonth() + i);
        return isoDay(dueDate);
    });
}

// A monthly repayment larger than the expected in-hand salary would leave a negative salary: refuse it.
// Only enforced once the employee has salary data, so an unset CTC never blocks the whole module.
function assertAffordable(salary: AdvanceSalarySummary, monthlyRepayment: number) {
    if (salary.monthlyCtc > 0 && round2(salary.currentInHand - monthlyRepayment) < 0) {
        throw new StaffLoanConfigurationError(
            `The monthly repayment of ₹${monthlyRepayment.toLocaleString('en-IN')} is more than the expected in-hand salary of ₹${salary.currentInHand.toLocaleString('en-IN')} after existing deductions. Reduce the advance amount.`,
        );
    }
}

function snapshotOf(salary: AdvanceSalarySummary, monthlyRepayment: number): Prisma.InputJsonValue {
    const projection = projectInHand(salary.currentInHand, monthlyRepayment);
    return {
        month: salary.month, year: salary.year, monthlyRepayment,
        currentInHand: projection.currentInHand, projectedInHand: projection.projectedInHand, capturedAt: new Date().toISOString(),
    };
}

// The uploaded file must sit in the applicant's own staff-advance folder and be a real, allowed file: the size and type
// recorded come from the stored object, never from the client.
async function verifyDocument(targetUserId: string, doc: { fileKey: string; fileName: string }) {
    if (!(await isStaffLoanDocumentKeyFor(targetUserId, doc.fileKey, 'staff-advance'))) throw new StaffLoanConfigurationError('The attached document is invalid. Upload it again.');
    const stored = await readStaffLoanDocument(doc.fileKey);
    if (!stored || !(STAFF_LOAN_DOCUMENT_ALLOWED_MIME as readonly string[]).includes(stored.contentType)) {
        throw new StaffLoanConfigurationError('The attached document is missing or is not an allowed file. Upload it again.');
    }
    return { documentKey: doc.fileKey, documentName: doc.fileName, documentMimeType: stored.contentType, documentSize: stored.buffer.byteLength };
}

// ── scopes / capabilities ─────────────────────────────────────────────────

async function approvalScope(actor: StaffLoanActor): Promise<Prisma.StaffAdvanceWhereInput | null> {
    const configs = await prisma.staffLoanWorkflowConfig.findMany({
        where: { OR: [{ kind: 'ADVANCE', isActive: true }, { advances: { some: { status: 'SUBMITTED' } } }] },
        include: workflowInclude,
    });
    const clauses: Prisma.StaffAdvanceWhereInput[] = [];
    for (const config of configs) {
        for (const stage of config.stages) {
            const scope = stage.role.isActive ? advanceRoleScope(actor, stage.roleId) : null;
            if (scope) clauses.push({ AND: [scope, { workflowConfigId: config.id, currentApprovalLevel: stage.levelOrder, status: 'SUBMITTED', employeeId: { not: actor.userId } }] });
        }
    }
    return clauses.length ? { OR: clauses } : null;
}

// Approved advances waiting to be paid out, for the disbursement-authority roles of each advance's workflow.
async function disbursementScope(actor: StaffLoanActor): Promise<Prisma.StaffAdvanceWhereInput | null> {
    const branchScope: Prisma.StaffAdvanceWhereInput = actor.branchIds === null ? {} : { branchId: { in: actor.branchIds } };
    if (actor.isAdmin) return { AND: [branchScope, { status: 'APPROVED', employeeId: { not: actor.userId } }] };
    const configs = await prisma.staffLoanWorkflowConfig.findMany({
        where: { OR: [{ kind: 'ADVANCE', isActive: true }, { advances: { some: { status: 'APPROVED' } } }] },
        include: workflowInclude,
    });
    const clauses: Prisma.StaffAdvanceWhereInput[] = [];
    for (const config of configs) {
        for (const role of config.disbursementRoles) {
            const scope = role.isActive ? advanceRoleScope(actor, role.id) : null;
            if (scope) clauses.push({ AND: [scope, { workflowConfigId: config.id, status: 'APPROVED', employeeId: { not: actor.userId } }] });
        }
    }
    return clauses.length ? { OR: clauses } : null;
}

async function advanceScopes(actor: StaffLoanActor) {
    return {
        register: advancePageScope(actor, ADVANCE_MANAGEMENT_PAGE),
        approval: await approvalScope(actor),
        disbursement: await disbursementScope(actor),
    };
}
type Scopes = Awaited<ReturnType<typeof advanceScopes>>;

const capabilitiesOf = (scopes: Scopes): AdvanceCapabilities => ({
    register: scopes.register !== null, approvals: scopes.approval !== null, disbursements: scopes.disbursement !== null,
});

export async function advanceCapabilities(actor: StaffLoanActor): Promise<AdvanceCapabilities> {
    return capabilitiesOf(await advanceScopes(actor));
}

// An advance the employee still has "open": under review, approved awaiting disbursement, or being repaid.
const unfinishedStatuses: AdvanceStatus[] = ['SUBMITTED', 'APPROVED', 'ACTIVE'];

// Who may see one advance: the applicant, the management page scope and the current approval and
// disbursement queues.
function visibility(actor: StaffLoanActor, scopes: Scopes, id: string): Prisma.StaffAdvanceWhereInput {
    const clauses: Prisma.StaffAdvanceWhereInput[] = [{ employeeId: actor.userId }];
    if (scopes.register) clauses.push(scopes.register);
    if (scopes.approval) clauses.push(scopes.approval);
    if (scopes.disbursement) clauses.push(scopes.disbursement);
    return clauses.some(isUnrestricted) ? { id } : { id, OR: clauses };
}

// ── options (apply page) ──────────────────────────────────────────────────

export async function advanceOptions(actor: StaffLoanActor, targetEmployeeId?: string): Promise<AdvanceOptions> {
    const canSelectEmployee = advanceCanApplyForOthers(actor);
    const employeeId = canSelectEmployee && targetEmployeeId?.trim() ? targetEmployeeId.trim() : actor.userId;

    const user = await prisma.user.findUnique({ where: { id: employeeId }, select: { id: true, branchId: true } });
    if (!user) throw new StaffLoanConfigurationError('Employee not found', 404);
    if (actor.branchIds !== null && user.branchId && !actor.branchIds.includes(user.branchId)) {
        throw new StaffLoanConfigurationError('Selected employee is outside your permitted branch scope.', 403);
    }

    const [employee, salary, obligations, open, workflow] = await Promise.all([
        loadEmployeeProfile(employeeId),
        getAdvanceSalarySummary(employeeId),
        loadObligations(employeeId),
        prisma.staffAdvance.findFirst({ where: { employeeId, status: { in: unfinishedStatuses } }, select: { advanceNumber: true, status: true } }),
        prisma.staffLoanWorkflowConfig.findFirst({ where: { kind: 'ADVANCE', isActive: true }, include: workflowInclude }),
    ]);

    let employees: EmployeeOption[] | undefined;
    if (canSelectEmployee) {
        const branchFilter = actor.branchIds === null ? {} : { branchId: { in: actor.branchIds } };
        const list = await prisma.user.findMany({
            where: { isActive: true, ...branchFilter },
            select: { id: true, firstName: true, lastName: true, employeeId: true, role: true, branch: { select: { name: true } } },
            orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }], take: 200,
        });
        employees = list.map(e => ({ id: e.id, name: `${e.firstName} ${e.lastName}`.trim(), employeeId: e.employeeId, branchName: e.branch?.name ?? null, role: e.role }));
    }

    return {
        employee, employees, canSelectEmployee, salary, obligations,
        openAdvance: open ? { advanceNumber: open.advanceNumber, status: open.status } : null,
        workflowAvailable: !!workflow && workflow.stages.length > 0 && workflow.stages.every(s => s.role.isActive) && workflow.disbursementRoles.some(r => r.isActive),
        repaymentMonths: ADVANCE_REPAYMENT_MONTHS,
    };
}

// ── apply ─────────────────────────────────────────────────────────────────

export async function applyForAdvance(actor: StaffLoanActor, input: AdvanceApplicationInput): Promise<AdvanceRow> {
    const { document, ...data } = advanceApplicationSchema.parse(input);
    const targetId = data.employeeId && data.employeeId !== actor.userId ? data.employeeId : actor.userId;
    if (targetId !== actor.userId && !advanceCanApplyForOthers(actor)) {
        throw new StaffLoanConfigurationError('You are only authorized to apply for your own staff advance.', 403);
    }

    const employee = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, isActive: true, branchId: true, branch: { select: { isActive: true } } } });
    if (!employee?.isActive || !employee.branchId || !employee.branch?.isActive) throw new StaffLoanConfigurationError('An active employee with a branch assignment is required.');
    if (actor.branchIds !== null && !actor.branchIds.includes(employee.branchId)) {
        throw new StaffLoanConfigurationError('Selected employee is outside your permitted branch scope.', 403);
    }

    const documentFields = await verifyDocument(targetId, document);

    const workflow = await prisma.staffLoanWorkflowConfig.findFirst({ where: { kind: 'ADVANCE', isActive: true }, include: workflowInclude });
    if (!workflow || !workflow.stages.length || workflow.stages.some(s => !s.role.isActive) || !workflow.disbursementRoles.some(r => r.isActive)) {
        throw new StaffLoanConfigurationError('The approval workflow is not configured yet. Contact the administrator.');
    }

    // Existing loans/advances are already inside the salary figures (their deductions), so an advance whose
    // repayment would push the in-hand salary below zero is refused before it is even submitted.
    const salary = await getAdvanceSalarySummary(targetId);
    const repaymentMonths = data.repaymentMonths ?? ADVANCE_REPAYMENT_MONTHS;
    const [monthly] = splitAdvanceInstallments(data.amount, repaymentMonths);
    assertAffordable(salary, monthly);
    const branchId = employee.branchId;
    const today = getKolkataCalendarYmd(new Date());

    try {
        return await prisma.$transaction(async tx => {
            const open = await tx.staffAdvance.findFirst({ where: { employeeId: targetId, status: { in: unfinishedStatuses } }, select: { advanceNumber: true, status: true } });
            if (open) {
                throw new StaffLoanConfigurationError(`This employee already has advance ${open.advanceNumber} ${open.status === 'ACTIVE' ? 'being repaid' : open.status === 'APPROVED' ? 'awaiting disbursement' : 'under review'}. A new advance can be requested once it is completed.`, 409);
            }
            const row = await tx.staffAdvance.create({
                data: {
                    advanceNumber: await nextAdvanceNumber(tx), employeeId: targetId, branchId, status: 'SUBMITTED',
                    amount: dec(String(data.amount)), repaymentMonths, purpose: data.purpose, remarks: data.remarks || null,
                    ...documentFields, workflowConfigId: workflow.id, currentApprovalLevel: 1, salarySnapshot: snapshotOf(salary, monthly), submittedAt: new Date(),
                },
                include: advanceInclude,
            });
            await tx.staffAdvanceDecision.create({ data: { advanceId: row.id, action: 'SUBMIT', actedById: actor.userId, remarks: data.remarks || null } });
            return toRow(row, actor, today);
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
        // The database allows a single open advance per employee: a concurrent second request loses here.
        if ((error as { code?: string })?.code === 'P2002') {
            throw new StaffLoanConfigurationError('This employee already has an advance under review or being repaid.', 409);
        }
        throw error;
    }
}

// ── lists ─────────────────────────────────────────────────────────────────

async function summaryCards(scope: Prisma.StaffAdvanceWhereInput): Promise<AdvanceSummaryCards> {
    const today = getKolkataCalendarYmd(new Date());
    const { monthStartUtc, monthEndExclusiveUtc } = getKolkataMonthBounds({ month: Number(today.slice(5, 7)), year: Number(today.slice(0, 4)) });
    const active: Prisma.StaffAdvanceWhereInput = { AND: [scope, { status: 'ACTIVE' }] };
    const [byStatus, activeDue, activePaid, repaid] = await Promise.all([
        prisma.staffAdvance.groupBy({ by: ['status'], where: scope, _count: { _all: true }, _sum: { amount: true } }),
        prisma.staffAdvanceSchedule.aggregate({ where: { advance: active }, _sum: { amountDue: true } }),
        prisma.staffAdvanceRepaymentAllocation.aggregate({ where: { schedule: { advance: active }, transaction: { status: 'POSTED' } }, _sum: { amount: true } }),
        prisma.staffAdvanceRepaymentAllocation.aggregate({
            where: { schedule: { advance: scope }, transaction: { status: 'POSTED', postedAt: { gte: monthStartUtc, lt: monthEndExclusiveUtc } } },
            _sum: { amount: true },
        }),
    ]);
    const count = (status: AdvanceStatus) => byStatus.find(g => g.status === status)?._count._all ?? 0;
    const sum = (status: AdvanceStatus) => Number(byStatus.find(g => g.status === status)?._sum.amount ?? 0);
    return {
        totalAdvances: byStatus.filter(g => g.status !== 'CANCELLED').reduce((total, g) => total + g._count._all, 0),
        activeAdvances: count('ACTIVE'),
        completedAdvances: count('COMPLETED'),
        totalAdvanceAmount: round2(sum('ACTIVE') + sum('COMPLETED')),
        totalOutstanding: Math.max(0, round2(Number(activeDue._sum.amountDue ?? 0) - Number(activePaid._sum.amount ?? 0))),
        repaidThisMonth: round2(Number(repaid._sum.amount ?? 0)),
    };
}

export async function listAdvances(actor: StaffLoanActor, tab: 'own' | 'register' | 'approvals' | 'disbursements', page: number): Promise<AdvanceList> {
    const scopes = await advanceScopes(actor);
    const capabilities = capabilitiesOf(scopes);
    let where: Prisma.StaffAdvanceWhereInput;
    if (tab === 'own') where = { employeeId: actor.userId };
    else if (tab === 'register' && scopes.register) where = scopes.register;
    else if (tab === 'approvals' && scopes.approval) where = scopes.approval;
    else if (tab === 'disbursements' && scopes.disbursement) where = scopes.disbursement;
    else throw new StaffLoanConfigurationError('You are not assigned access to this staff advance list.', 403);

    const [items, total] = await prisma.$transaction([
        prisma.staffAdvance.findMany({ where, include: advanceInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
        prisma.staffAdvance.count({ where }),
    ]);
    const today = getKolkataCalendarYmd(new Date());
    return {
        items: items.map(row => toRow(row, actor, today)), page, pageSize: PAGE_SIZE, total, capabilities,
        summary: tab === 'register' && scopes.register ? await summaryCards(scopes.register) : null,
        salaryDay: tab === 'disbursements' ? await loanSalaryDay(prisma) : null,
    };
}

// ── detail ────────────────────────────────────────────────────────────────

export async function advanceDetail(actor: StaffLoanActor, id: string): Promise<AdvanceDetail> {
    const scopes = await advanceScopes(actor);
    const row = await prisma.staffAdvance.findFirst({
        where: visibility(actor, scopes, id),
        include: { ...advanceInclude, decisions: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { actedBy: { select: { firstName: true, lastName: true } } } } },
    });
    if (!row) throw new StaffLoanConfigurationError('Staff advance not found', 404);

    const today = getKolkataCalendarYmd(new Date());
    const base = toRow(row, actor, today);
    const [employee, salary, obligations] = await Promise.all([loadEmployeeProfile(row.employeeId), getAdvanceSalarySummary(row.employeeId), loadObligations(row.employeeId, row.id)]);

    // Under review: what payroll would show after this advance. Once approved: the figure recorded at application.
    const snapshot = row.salarySnapshot as Snapshot | null;
    const projection = row.status === 'SUBMITTED' || !snapshot
        ? projectInHand(salary.currentInHand, base.monthlyRepayment)
        : projectInHand(snapshot.currentInHand, base.monthlyRepayment);

    const disbursed = row.status === 'ACTIVE' || row.status === 'COMPLETED';
    let schedulePreview: AdvanceDetail['schedulePreview'] = null;
    if (row.status === 'SUBMITTED' || row.status === 'APPROVED') {
        // Expected dates if disbursed today, on the default month (this month while its salary date is still ahead).
        const salaryDay = await loanSalaryDay(prisma);
        if (salaryDay !== null) {
            const dates = buildSalaryDueDates(today, defaultFirstDueMonth(today, salaryDay), salaryDay, row.repaymentMonths);
            const amounts = splitAdvanceInstallments(base.amount, row.repaymentMonths);
            schedulePreview = dates.map((dueDate, i) => ({ installmentNo: i + 1, dueDate, amount: amounts[i] }));
        }
    }

    return {
        ...base, employee, salary, projection, obligations,
        stages: row.workflowConfig?.stages.map(s => ({ levelOrder: s.levelOrder, stageName: s.stageName, roleName: s.role.name })) ?? [],
        decisions: row.decisions.map(d => ({
            id: d.id, action: d.action, stageName: d.stageName, remarks: d.remarks, actorName: `${d.actedBy.firstName} ${d.actedBy.lastName}`.trim(),
            createdAt: d.createdAt.toISOString(), changes: (d.changes as Record<string, { from: unknown; to: unknown }> | null) ?? null,
        })),
        payment: disbursed && row.paymentMode ? { mode: row.paymentMode, reference: row.paymentReference } : null,
        schedule: disbursed ? scheduleRows(row, today) : null,
        schedulePreview,
    };
}

// ── edit / review / cancel ────────────────────────────────────────────────

const money = (n: number) => `₹${n.toLocaleString('en-IN')}`;

// The current-stage reviewer (or admin) may correct the amount, reason and remarks while the advance is under
// review. Each edit stores who/when (the decision row), the previous and new values (changes), and refreshes
// the salary projection.
export async function editAdvance(actor: StaffLoanActor, id: string, input: AdvanceEditInput): Promise<AdvanceRow> {
    const { document, ...data } = advanceEditSchema.parse(input);
    const pre = await prisma.staffAdvance.findUnique({ where: { id }, include: advanceInclude });
    if (!pre) throw new StaffLoanConfigurationError('Staff advance not found', 404);
    // Authorize before any business validation, so an unauthorized caller never sees salary-based messages.
    if (!reviewerStage(pre, actor)) throw new StaffLoanConfigurationError('You are not authorized to edit this application.', 403);
    const documentFields = document ? await verifyDocument(pre.employeeId, document) : null;
    const salary = await getAdvanceSalarySummary(pre.employeeId);
    // The repayment period is chosen on the application and is not editable by the reviewer.
    const [monthly] = splitAdvanceInstallments(data.amount, pre.repaymentMonths);
    assertAffordable(salary, monthly);
    const today = getKolkataCalendarYmd(new Date());

    return prisma.$transaction(async tx => {
        const row = await tx.staffAdvance.findUnique({ where: { id }, include: advanceInclude });
        if (!row) throw new StaffLoanConfigurationError('Staff advance not found', 404);
        const stage = reviewerStage(row, actor);
        if (!stage) throw new StaffLoanConfigurationError('You are not authorized to edit this application.', 403);
        if (row.version !== data.expectedVersion) throw new StaffLoanConfigurationError('Application is no longer awaiting this review. Reload the queue.', 409);

        const changes: Record<string, { from: unknown; to: unknown }> = {};
        const summary: string[] = [];
        if (data.amount !== Number(row.amount)) { changes.amount = { from: Number(row.amount), to: data.amount }; summary.push(`Amount ${money(Number(row.amount))} → ${money(data.amount)}`); }
        if (data.purpose !== row.purpose) { changes.purpose = { from: row.purpose, to: data.purpose }; summary.push('Purpose updated'); }
        if (data.remarks !== (row.remarks ?? '')) { changes.remarks = { from: row.remarks ?? '', to: data.remarks }; summary.push('Remarks updated'); }
        if (documentFields && documentFields.documentKey !== row.documentKey) { changes.document = { from: row.documentName ?? null, to: documentFields.documentName }; summary.push(`Document replaced (${documentFields.documentName})`); }
        if (!summary.length) throw new StaffLoanConfigurationError('No changes to save.');

        const updated = await tx.staffAdvance.updateMany({
            where: { id: row.id, version: data.expectedVersion, status: 'SUBMITTED' },
            data: { amount: dec(String(data.amount)), purpose: data.purpose, remarks: data.remarks || null, ...(documentFields ?? {}), salarySnapshot: snapshotOf(salary, monthly), version: { increment: 1 } },
        });
        if (updated.count !== 1) throw new StaffLoanConfigurationError('Another reviewer changed this application. Reload the queue.', 409);
        await tx.staffAdvanceDecision.create({
            data: {
                advanceId: row.id, action: 'EDIT', stageOrder: stage.levelOrder, stageName: stage.stageName, actedById: actor.userId,
                remarks: summary.join('; ') + (data.reason ? ` — ${data.reason}` : ''), changes: changes as Prisma.InputJsonValue,
            },
        });
        return toRow(await tx.staffAdvance.findUniqueOrThrow({ where: { id: row.id }, include: advanceInclude }), actor, today);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

// Short-lived signed URL of the supporting document, for anyone who may see the advance (applicant, reviewers, register).
export async function advanceDocumentAccess(actor: StaffLoanActor, id: string) {
    const scopes = await advanceScopes(actor);
    const row = await prisma.staffAdvance.findFirst({ where: visibility(actor, scopes, id), select: { documentKey: true, documentName: true, documentMimeType: true } });
    if (!row) throw new StaffLoanConfigurationError('Staff advance not found', 404);
    if (!row.documentKey) throw new StaffLoanConfigurationError('No document is attached to this application.', 404);
    return { url: await getSignedReadUrl(row.documentKey), fileName: row.documentName ?? 'Document', mimeType: row.documentMimeType ?? '' };
}

// Whose folder a reviewer's replacement document goes into: the applicant's, and only for an advance the reviewer may
// currently edit. Lets an approver upload without holding "apply for others" rights.
export async function advanceDocumentUploadTargetForReviewer(actor: StaffLoanActor, advanceId: string) {
    const row = await prisma.staffAdvance.findUnique({ where: { id: advanceId }, include: advanceInclude });
    if (!row) throw new StaffLoanConfigurationError('Staff advance not found', 404);
    if (!reviewerStage(row, actor)) throw new StaffLoanConfigurationError('You are not authorized to change the document of this application.', 403);
    return row.employeeId;
}

export async function reviewAdvance(actor: StaffLoanActor, input: unknown) {
    const data = advanceReviewSchema.parse(input);
    const pre = await prisma.staffAdvance.findUnique({ where: { id: data.id }, include: advanceInclude });
    if (!pre) throw new StaffLoanConfigurationError('Staff advance not found', 404);
    // Authorize before any business validation, so an unauthorized caller never sees salary-based messages.
    if (!reviewerStage(pre, actor)) throw new StaffLoanConfigurationError('You are not authorized to review this application.', 403);
    if (data.action === 'APPROVE') {
        // Existing loans and advances are considered at approval time too, with the salary as it is now.
        assertAffordable(await getAdvanceSalarySummary(pre.employeeId), splitAdvanceInstallments(Number(pre.amount), pre.repaymentMonths)[0]);
    }

    return prisma.$transaction(async tx => {
        const row = await tx.staffAdvance.findUnique({ where: { id: data.id }, include: advanceInclude });
        if (!row) throw new StaffLoanConfigurationError('Staff advance not found', 404);
        const stage = reviewerStage(row, actor);
        if (!stage) throw new StaffLoanConfigurationError('You are not authorized to review this application.', 403);
        if (row.version !== data.expectedVersion) throw new StaffLoanConfigurationError('Application is no longer awaiting this review. Reload the queue.', 409);

        const next = row.workflowConfig!.stages.find(s => s.levelOrder === stage.levelOrder + 1);
        const finalApproval = data.action === 'APPROVE' && !next;
        // Final approval does not activate the advance: it waits (APPROVED) for a disbursement-authority holder.
        const status = data.action === 'REJECT' ? 'REJECTED' : finalApproval ? 'APPROVED' : 'SUBMITTED';

        const updated = await tx.staffAdvance.updateMany({
            where: { id: row.id, version: data.expectedVersion, status: 'SUBMITTED' },
            data: {
                status, currentApprovalLevel: data.action === 'APPROVE' && next ? next.levelOrder : null,
                ...(finalApproval ? { approvedAt: new Date() } : {}), version: { increment: 1 },
            },
        });
        if (updated.count !== 1) throw new StaffLoanConfigurationError('Another reviewer changed this application. Reload the queue.', 409);

        await tx.staffAdvanceDecision.create({
            data: { advanceId: row.id, action: data.action, stageOrder: stage.levelOrder, stageName: stage.stageName, actedById: actor.userId, remarks: data.remarks || null },
        });
        return { status: status as AdvanceStatus };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

// Pays out an approved advance: records how it was paid, activates it and creates the two interest-free
// installments (due by the staff loan salary-date rules). Only a disbursement-authority holder of the
// advance's workflow (or an admin) may do this, never the applicant.
export async function disburseAdvance(actor: StaffLoanActor, input: unknown) {
    const data = advanceDisburseSchema.parse(input);
    return prisma.$transaction(async tx => {
        const row = await tx.staffAdvance.findUnique({ where: { id: data.id }, include: advanceInclude });
        if (!row || row.status !== 'APPROVED') throw new StaffLoanConfigurationError('Staff advance is not approved or is not ready for disbursement.', 400);
        if (row.version !== data.expectedVersion) throw new StaffLoanConfigurationError('Staff advance has changed. Please reload.', 409);
        if (!canDisburseAdvance(row, actor)) throw new StaffLoanConfigurationError('You are not authorized to disburse this staff advance.', 403);

        const employee = await tx.user.findUnique({ where: { id: row.employeeId }, select: { isActive: true, branchId: true, branch: { select: { isActive: true } } } });
        if (!employee?.isActive || !employee.branchId || !employee.branch?.isActive) {
            throw new StaffLoanConfigurationError('Employee is no longer active or assigned to an active branch.', 400);
        }

        // Validate the due dates before anything is written.
        const dates = await plannedDueDates(tx, data.disbursementDate, row.repaymentMonths, { firstDueMonth: data.firstDueMonth, firstDueDate: data.firstDueDate });

        const updated = await tx.staffAdvance.updateMany({
            where: { id: row.id, version: data.expectedVersion, status: 'APPROVED' },
            data: {
                status: 'ACTIVE', disbursedAt: new Date(data.disbursementDate), paymentMode: data.paymentMode,
                paymentReference: data.reference || null, version: { increment: 1 },
            },
        });
        if (updated.count !== 1) throw new StaffLoanConfigurationError('Disbursement collision. Reload before proceeding.', 409);

        const amounts = splitAdvanceInstallments(Number(row.amount), row.repaymentMonths);
        await tx.staffAdvanceSchedule.createMany({
            data: dates.map((dueDate, i) => ({ advanceId: row.id, installmentNo: i + 1, dueDate: new Date(dueDate), amountDue: dec(amounts[i]) })),
        });
        await tx.staffAdvanceDecision.create({
            data: {
                advanceId: row.id, action: 'DISBURSE', actedById: actor.userId,
                remarks: [`${data.paymentMode === 'BANK_TRANSFER' ? 'Bank transfer' : 'Cash'} on ${data.disbursementDate}`, data.reference ? `Ref ${data.reference}` : null, data.remarks || null].filter(Boolean).join(' - '),
            },
        });
        return { status: 'ACTIVE' as const, advanceNumber: row.advanceNumber };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function cancelAdvance(actor: StaffLoanActor, input: unknown) {
    const data = advanceCancelSchema.parse(input);
    return prisma.$transaction(async tx => {
        const result = await tx.staffAdvance.updateMany({
            where: { id: data.id, employeeId: actor.userId, version: data.expectedVersion, status: 'SUBMITTED' },
            data: { status: 'CANCELLED', currentApprovalLevel: null, version: { increment: 1 } },
        });
        if (result.count !== 1) throw new StaffLoanConfigurationError('Application changed or can no longer be cancelled.', 409);
        await tx.staffAdvanceDecision.create({ data: { advanceId: data.id, action: 'CANCEL', actedById: actor.userId } });
        return { status: 'CANCELLED' as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
