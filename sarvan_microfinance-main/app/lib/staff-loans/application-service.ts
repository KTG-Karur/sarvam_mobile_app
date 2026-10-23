import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/app/lib/db';
import { getKolkataCalendarYmd } from '@/app/lib/branch-lock';
import { schemeSchema } from './configuration';
import { StaffLoanConfigurationError } from './configuration-service';
import {
    applicationSchema, disburseSchema, editTermsSchema, formatStaffLoanNumber, previewInstallments, roleCanAct, serviceMonths, totalFlatInterest,
    repaymentSchema, settlementSchema,
    type ApplicationDetail, type ApplicationInput, type ApplicationOption, type ApplicationOptions, type ApplicationRow, type DisburseInput,
    type EditTermsInput, type EmployeeOption, type EmployeeProfileDetail, type PastLoanRow, type StaffLoanInterestType,
    type ManagementCapabilities, type RepaymentInput, type SettlementInput, type LoanRepaymentSummary,
    type ScheduleRow, type RepaymentTransactionRow
} from './application';
import { actorRoleCanAct, canApplyForOthers, registerScope, roleBranchScope, type StaffLoanActor } from './application-access';
import { allocateAcrossSchedules, totalOutstanding } from './allocation';
import { STAFF_LOAN_DOCUMENT_ALLOWED_MIME } from './document-rule';
import { buildSalaryDueDates, isValidSalaryDay } from './salary-schedule';
import { isStaffLoanDocumentKeyFor, readStaffLoanDocument } from '@/app/lib/storage/staff-loan-document-storage';
import { getSignedReadUrl } from '@/app/lib/storage/gcs-client';

const employeeSelect = {
    id: true, employeeId: true, firstName: true, lastName: true, isActive: true, dateOfJoining: true,
    branchId: true, departmentId: true, role: true,
    branch: { select: { id: true, name: true, isActive: true } },
    department: { select: { id: true, name: true } },
    userRoles: { where: { isActive: true }, select: { roleId: true } },
} satisfies Prisma.UserSelect;
const schemeInclude = {
    applicableBranches: { select: { id: true, isActive: true } }, applicableDepartments: { select: { id: true, isActive: true } },
    applicableRoles: { select: { id: true, isActive: true, slug: true } }, salaryBasisComponents: { select: { id: true, isActive: true, type: true } },
} satisfies Prisma.StaffLoanSchemeInclude;
const workflowInclude = { stages: { orderBy: { levelOrder: 'asc' as const }, include: { role: { select: { name: true, isActive: true } } } }, disbursementRoles: { select: { id: true, isActive: true } } } satisfies Prisma.StaffLoanWorkflowConfigInclude;
const loanInclude = {
    employee: { select: { firstName: true, lastName: true, employeeId: true } }, branch: { select: { name: true } },
    workflowConfig: { include: workflowInclude },
} satisfies Prisma.StaffLoanInclude;
type Scheme = Prisma.StaffLoanSchemeGetPayload<{ include: typeof schemeInclude }>;
type Employee = Prisma.UserGetPayload<{ select: typeof employeeSelect }>;
type LoanRow = Prisma.StaffLoanGetPayload<{ include: typeof loanInclude }>;

function schemeSnapshot(s: Scheme) {
    return schemeSchema.parse({
        code: s.code, name: s.name, description: s.description ?? '', minimumServiceMonths: s.minimumServiceMonths,
        minimumSalaryPerMonth: Number(s.minimumSalaryPerMonth),
        amountBasis: s.amountBasis, maximumAmount: s.maximumAmount === null ? null : Number(s.maximumAmount),
        salaryMultiplier: s.salaryMultiplier === null ? null : Number(s.salaryMultiplier), maximumTenureMonths: s.maximumTenureMonths,
        maximumActiveLoans: s.maximumActiveLoans,
        interestType: s.interestType, annualInterestRate: Number(s.annualInterestRate),
        isActive: s.isActive,
        branchIds: s.applicableBranches.map(r => r.id), departmentIds: s.applicableDepartments.map(r => r.id),
        roleIds: s.applicableRoles.map(r => r.id), salaryBasisComponentIds: s.salaryBasisComponents.map(r => r.id),
    });
}

function applicable(s: Scheme, employee: Employee, actor: StaffLoanActor) {
    const branchMatch = !s.applicableBranches.length || s.applicableBranches.some(b => b.id === employee.branchId && b.isActive);
    const deptMatch = !s.applicableDepartments.length || (employee.departmentId && s.applicableDepartments.some(d => d.id === employee.departmentId && d.isActive));
    const roleMatch = !s.applicableRoles.length || s.applicableRoles.some(r => {
        if (!r.isActive) return false;
        if (employee.userRoles?.some(ur => ur.roleId === r.id)) return true;
        const employeeRole = (employee.role ?? '').toUpperCase();
        return (employeeRole === 'BM' || employeeRole === 'BRANCH_MANAGER') && r.slug === 'branch-manager'
            || (employeeRole === 'AM' || employeeRole === 'AREA_MANAGER') && r.slug === 'area-manager'
            || employeeRole === 'FDO' && r.slug === 'fdo'
            || employeeRole === 'ADMIN' && r.slug === 'admin';
    });
    return !!(branchMatch && deptMatch && roleMatch);
}

function formatServicePeriod(months: number) {
    if (months <= 0) return '0 months';
    const yrs = Math.floor(months / 12);
    const rem = months % 12;
    if (yrs === 0) return `${rem} ${rem === 1 ? 'month' : 'months'}`;
    if (rem === 0) return `${yrs} ${yrs === 1 ? 'year' : 'years'}`;
    return `${yrs} ${yrs === 1 ? 'yr' : 'yrs'} ${rem} ${rem === 1 ? 'mo' : 'mos'}`;
}

async function eligibility(tx: Prisma.TransactionClient, s: Scheme, employee: Employee, actor: StaffLoanActor, excludingId?: string) {
    const today = getKolkataCalendarYmd(new Date());
    let error: string | null = null;
    let maximumAmount = s.maximumAmount === null ? null : Number(s.maximumAmount);
    let salaryBasis: number | null = null;
    if (!employee.isActive || !employee.branchId || !employee.branch?.isActive) error = 'An active employee and branch assignment are required.';
    else if (!applicable(s, employee, actor)) error = 'This scheme does not apply to your employee profile.';
    else if (!employee.dateOfJoining) error = 'Your joining date must be recorded before applying.';
    else if (serviceMonths(getKolkataCalendarYmd(employee.dateOfJoining), today) < s.minimumServiceMonths) error = `This scheme requires ${s.minimumServiceMonths} completed months of service.`;
    const minimumSalary = Number(s.minimumSalaryPerMonth);
    if (!error && minimumSalary > 0) {
        const earnings = await tx.employeeSalaryMaster.findMany({
            where: { employeeId: employee.id, isActive: true, salaryComponent: { type: 'EARNINGS', isActive: true } },
            select: { amount: true },
        });
        const grossSalary = earnings.reduce((sum, a) => sum.plus(a.amount), new Prisma.Decimal(0)).toNumber();
        if (grossSalary < minimumSalary) error = `This scheme requires a minimum monthly salary of ₹${minimumSalary.toLocaleString('en-IN')}.`;
    }
    if (s.amountBasis === 'SALARY_MULTIPLE') {
        const componentIds = s.salaryBasisComponents.filter(c => c.isActive && c.type === 'EARNINGS').map(c => c.id);
        const amounts = await tx.employeeSalaryMaster.findMany({ where: { employeeId: employee.id, isActive: true, salaryComponentId: { in: componentIds } }, select: { salaryComponentId: true, amount: true } });
        if (!componentIds.length || componentIds.length !== s.salaryBasisComponents.length || amounts.length !== componentIds.length || !s.salaryMultiplier) {
            error ??= 'Salary basis is incomplete. Contact HR to update salary records.';
            maximumAmount = null;
        } else {
            const salary = amounts.reduce((sum, a) => sum.plus(a.amount), new Prisma.Decimal(0));
            salaryBasis = salary.toNumber(); maximumAmount = salary.mul(s.salaryMultiplier).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN).toNumber();
            if (maximumAmount <= 0) error ??= 'A positive salary basis is required for this scheme.';
        }
    }
    const activeCount = await tx.staffLoan.count({ where: {
        employeeId: employee.id, ...(excludingId ? { id: { not: excludingId } } : {}),
        status: { in: ['SUBMITTED', 'RETURNED', 'APPROVED', 'ACTIVE'] },
    } });
    if (activeCount >= s.maximumActiveLoans) error ??= 'Your active-loan limit has been reached, including applications under review.';
    return { error, maximumAmount, salaryBasis, activeCount, checkedOn: today };
}

export async function applicationOptions(actor: StaffLoanActor, targetEmployeeId?: string): Promise<ApplicationOptions> {
    const canSelectEmployee = canApplyForOthers(actor);
    let employeeIdToEvaluate = actor.userId;
    if (canSelectEmployee && targetEmployeeId && targetEmployeeId.trim()) {
        employeeIdToEvaluate = targetEmployeeId.trim();
    }

    const employee = await prisma.user.findUnique({ where: { id: employeeIdToEvaluate }, select: employeeSelect });
    if (!employee) throw new StaffLoanConfigurationError('Employee not found', 404);
    if (actor.branchIds !== null && employee.branchId && !actor.branchIds.includes(employee.branchId)) {
        throw new StaffLoanConfigurationError('Selected employee is outside your permitted branch scope.', 403);
    }

    const today = getKolkataCalendarYmd(new Date());
    const serviceM = employee.dateOfJoining ? serviceMonths(getKolkataCalendarYmd(employee.dateOfJoining), today) : 0;

    const salaryRecords = (await prisma.employeeSalaryMaster?.findMany({
        where: { employeeId: employee.id, isActive: true, salaryComponent: { type: 'EARNINGS', isActive: true } },
        select: { amount: true },
    })) ?? [];
    const grossSalary = salaryRecords.reduce((sum, r) => sum.plus(r.amount), new Prisma.Decimal(0)).toNumber();

    const activeLoansCount = await prisma.staffLoan.count({
        where: { employeeId: employee.id, status: { in: ['SUBMITTED', 'RETURNED', 'APPROVED', 'ACTIVE'] } },
    });

    const schemes = await prisma.staffLoanScheme.findMany({ where: { isActive: true }, include: schemeInclude, orderBy: { name: 'asc' } });
    const result: ApplicationOption[] = [];
    for (const s of schemes.filter(s => applicable(s, employee, actor))) {
        const check = await eligibility(prisma, s, employee, actor);
        result.push({ id: s.id, name: s.name, code: s.code, maximumAmount: check.maximumAmount, maximumTenureMonths: s.maximumTenureMonths,
            minimumServiceMonths: s.minimumServiceMonths, minimumSalaryPerMonth: Number(s.minimumSalaryPerMonth), maximumActiveLoans: s.maximumActiveLoans,
            interestType: s.interestType, annualInterestRate: Number(s.annualInterestRate), recoveryMethods: ['SALARY'], eligibilityError: check.error });
    }
    const workflow = await prisma.staffLoanWorkflowConfig.findFirst({ where: { kind: 'LOAN', isActive: true }, include: workflowInclude });

    let employees: EmployeeOption[] | undefined;
    if (canSelectEmployee) {
        const branchFilter = actor.branchIds === null ? {} : { branchId: { in: actor.branchIds } };
        const employeeList = await prisma.user.findMany({
            where: { isActive: true, ...branchFilter },
            select: { id: true, firstName: true, lastName: true, employeeId: true, role: true, branch: { select: { name: true } } },
            orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
            take: 200,
        });
        employees = employeeList.map(e => ({
            id: e.id,
            name: `${e.firstName} ${e.lastName}`,
            employeeId: e.employeeId,
            branchName: e.branch?.name ?? null,
            role: e.role,
        }));
    }

    return {
        employee: {
            id: employee.id,
            name: `${employee.firstName} ${employee.lastName}`,
            employeeId: employee.employeeId,
            branchName: employee.branch?.name ?? null,
            branchId: employee.branchId,
            departmentName: employee.department?.name ?? null,
            dateOfJoining: employee.dateOfJoining ? getKolkataCalendarYmd(employee.dateOfJoining) : null,
            serviceMonths: serviceM,
            serviceFormatted: formatServicePeriod(serviceM),
            designation: employee.role,
            grossSalary,
            activeLoansCount,
        },
        employees,
        canSelectEmployee,
        schemes: result,
        workflowAvailable: !!workflow && workflow.stages.length > 0 && workflow.stages.every(s => s.role.isActive) && workflow.disbursementRoles.some(r => r.isActive),
    };
}

// Interest, total payable and EMI come from the same calculation the repayment schedule is built from.
function loanTerms(principal: number, months: number, interestType: StaffLoanInterestType, rate: number) {
    try {
        const preview = previewInstallments(principal, months, interestType, rate);
        return { interestAmount: preview.totalInterest, totalPayable: preview.totalRepayment, monthlyInstallment: preview.installments[0]?.total ?? 0 };
    } catch {
        return { interestAmount: 0, totalPayable: 0, monthlyInstallment: 0 };
    }
}

async function nextLoanNumber(tx: Prisma.TransactionClient) {
    const rows = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('staff_loan_number_seq') AS n`;
    return formatStaffLoanNumber(rows[0].n);
}

function serialize(row: LoanRow, actor: StaffLoanActor): ApplicationRow {
    const snapshot = row.schemeSnapshot as { name?: string };
    const stage = row.workflowConfig?.stages.find(s => s.levelOrder === row.currentApprovalLevel);
    return {
        id: row.id, loanNumber: row.loanNumber, employeeId: row.employeeId, employeeName: `${row.employee.firstName} ${row.employee.lastName}`,
        employeeCode: row.employee.employeeId, branchName: row.branch.name, schemeName: snapshot.name ?? '', status: row.status,
        requestedAmount: Number(row.requestedAmount), approvedAmount: row.approvedAmount === null ? null : Number(row.approvedAmount),
        tenureMonths: row.tenureMonths, interestType: row.interestType, annualInterestRate: Number(row.annualInterestRate), recoveryMethod: row.recoveryMethod,
        purpose: row.purpose, remarks: row.remarks ?? '', schemeId: row.schemeId, version: row.version,
        ...loanTerms(Number(row.approvedAmount ?? row.requestedAmount), row.tenureMonths, row.interestType, Number(row.annualInterestRate)),
        document: row.documentKey ? { fileKey: row.documentKey, fileName: row.documentName ?? 'Document', mimeType: row.documentMimeType ?? '', fileSize: row.documentSize ?? 0 } : null,
        currentStage: stage?.stageName ?? null,
        canReview: row.status === 'SUBMITTED' && row.employeeId !== actor.userId && !!stage && stage.role.isActive && actorRoleCanAct(actor, stage.roleId, row.branchId),
        createdAt: row.createdAt.toISOString(),
    };
}

async function verifyDocument(targetUserId: string, doc: { fileKey: string; fileName: string }) {
    if (!(await isStaffLoanDocumentKeyFor(targetUserId, doc.fileKey))) throw new StaffLoanConfigurationError('The attached document is invalid. Upload it again.');
    const stored = await readStaffLoanDocument(doc.fileKey);
    if (!stored || !(STAFF_LOAN_DOCUMENT_ALLOWED_MIME as readonly string[]).includes(stored.contentType)) {
        throw new StaffLoanConfigurationError('The attached document is missing or is not an allowed file. Upload it again.');
    }
    return { documentKey: doc.fileKey, documentName: doc.fileName, documentMimeType: stored.contentType, documentSize: stored.buffer.byteLength };
}

export async function saveApplication(actor: StaffLoanActor, input: ApplicationInput, submit: boolean, update?: { id: string; expectedVersion: number }) {
    const { document, ...data } = applicationSchema.parse(input);
    const documentTarget = data.employeeId && data.employeeId !== actor.userId ? data.employeeId : actor.userId;
    if (documentTarget !== actor.userId && !canApplyForOthers(actor)) throw new StaffLoanConfigurationError('You are only authorized to apply for your own staff loan.', 403);
    const documentFields = await verifyDocument(documentTarget, document);
    return prisma.$transaction(async tx => {
        let targetUserId = actor.userId;
        if (data.employeeId && data.employeeId !== actor.userId) {
            if (!canApplyForOthers(actor)) {
                throw new StaffLoanConfigurationError('You are only authorized to apply for your own staff loan.', 403);
            }
            targetUserId = data.employeeId;
        }
        const previous = update ? await tx.staffLoan.findFirst({ where: { id: update.id, ...(canApplyForOthers(actor) ? {} : { employeeId: actor.userId }) } }) : null;
        if (update && (!previous || previous.version !== update.expectedVersion || !['DRAFT', 'RETURNED'].includes(previous.status))) throw new StaffLoanConfigurationError('Application changed or is no longer editable. Reload before saving.', 409);
        const employee = await tx.user.findUnique({ where: { id: targetUserId }, select: employeeSelect });
        if (!employee?.branchId || !employee.isActive) throw new StaffLoanConfigurationError('An active employee branch assignment is required.');
        if (actor.branchIds !== null && !actor.branchIds.includes(employee.branchId)) {
            throw new StaffLoanConfigurationError('Selected employee is outside your permitted branch scope.', 403);
        }
        if (previous && previous.branchId !== employee.branchId) throw new StaffLoanConfigurationError('Your branch assignment changed after this application was created. Contact HR before proceeding.');
        const scheme = await tx.staffLoanScheme.findUnique({ where: { id: data.schemeId }, include: schemeInclude });
        if (!scheme?.isActive) throw new StaffLoanConfigurationError('This scheme is unavailable. Select an active scheme.');
        const check = await eligibility(tx, scheme, employee, actor, update?.id);
        if (check.error) throw new StaffLoanConfigurationError(check.error);
        if (check.maximumAmount === null || data.requestedAmount > check.maximumAmount) throw new StaffLoanConfigurationError('Requested amount exceeds the scheme limit.');
        if (data.tenureMonths > scheme.maximumTenureMonths) throw new StaffLoanConfigurationError('Requested tenure exceeds the scheme limit.');
        if (!['SALARY', 'CASH_BANK'].includes(data.recoveryMethod)) throw new StaffLoanConfigurationError('Invalid recovery method. Must be SALARY or CASH_BANK.');
        const workflow = submit ? (previous?.workflowConfigId
            ? await tx.staffLoanWorkflowConfig.findUnique({ where: { id: previous.workflowConfigId }, include: workflowInclude })
            : await tx.staffLoanWorkflowConfig.findFirst({ where: { kind: 'LOAN', isActive: true }, include: workflowInclude })) : null;
        if (submit && (!workflow?.stages.length || workflow.stages.some((s, i) => !s.role.isActive || s.levelOrder !== i + 1) || !workflow.disbursementRoles.some(r => r.isActive))) throw new StaffLoanConfigurationError('A complete staff loan approval workflow is required before submission.');
        if (submit && workflow) {
            for (const stage of workflow.stages) {
                const approverRole = tx.role?.findUnique ? await tx.role.findUnique({ where: { id: stage.roleId }, select: { slug: true, legacyRole: true } }) : null;
                const legacyRole = (approverRole?.legacyRole ?? approverRole?.slug ?? (stage.role as any)?.slug ?? '').toUpperCase();
                const branchCondition = { OR: [{ branchId: null }, { branchId: employee.branchId }] };

                const rbacCount = tx.userRoleAssignment?.count ? await tx.userRoleAssignment.count({ where: {
                    roleId: stage.roleId, isActive: true, userId: { not: targetUserId }, user: { isActive: true },
                    AND: [branchCondition, { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
                } }) : 0;

                const directUserCount = (legacyRole && tx.user?.count) ? await tx.user.count({ where: {
                    isActive: true, id: { not: targetUserId },
                    role: { in: [legacyRole, ...(legacyRole === 'BM' ? ['BRANCH_MANAGER'] : legacyRole === 'AM' ? ['AREA_MANAGER'] : [])] },
                    AND: [{ OR: [{ branchId: null }, { branchId: employee.branchId }] }],
                } }) : 0;

                const adminCount = tx.user?.count ? await tx.user.count({ where: { isActive: true, role: 'ADMIN', id: { not: targetUserId } } }) : 0;

                if (rbacCount === 0 && directUserCount === 0 && adminCount === 0) {
                    throw new StaffLoanConfigurationError(`No eligible reviewer is assigned to ${stage.stageName}. Contact the workflow administrator.`);
                }
            }
        }
        const payload = {
            schemeId: data.schemeId,
            requestedAmount: data.requestedAmount,
            tenureMonths: data.tenureMonths,
            recoveryMethod: data.recoveryMethod,
            purpose: data.purpose,
            remarks: data.remarks,
            ...documentFields,
            branchId: employee.branchId, schemeVersion: scheme.version, schemeSnapshot: schemeSnapshot(scheme),
            eligibilitySnapshot: check, interestType: scheme.interestType, annualInterestRate: scheme.annualInterestRate,
            status: submit ? 'SUBMITTED' as const : previous?.status === 'RETURNED' ? 'RETURNED' as const : 'DRAFT' as const,
            ...(submit && workflow ? { workflowConfigId: workflow.id, currentApprovalLevel: 1, submittedAt: new Date(), approvedAmount: null, approvedAt: null } : {}),
        };
        let row;
        if (update) {
            const changed = await tx.staffLoan.updateMany({ where: { id: update.id, ...(canApplyForOthers(actor) ? {} : { employeeId: actor.userId }), version: update.expectedVersion, status: { in: ['DRAFT', 'RETURNED'] } }, data: { ...payload, version: { increment: 1 } } });
            if (changed.count !== 1) throw new StaffLoanConfigurationError('Application changed. Reload before saving.', 409);
            row = await tx.staffLoan.findUniqueOrThrow({ where: { id: update.id }, include: loanInclude });
        } else {
            row = await tx.staffLoan.create({ data: { ...payload, employeeId: targetUserId, loanNumber: await nextLoanNumber(tx) }, include: loanInclude });
        }
        if (submit) await tx.staffLoanDecision.create({ data: { loanId: row.id, actedById: actor.userId, action: previous?.status === 'RETURNED' ? 'RESUBMIT' : 'SUBMIT', remarks: data.remarks || null } });
        return serialize(row, actor);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function managementScopes(actor: StaffLoanActor) {
    const branchScope = actor.branchIds === null ? {} : { branchId: { in: actor.branchIds } };
    const register = registerScope(actor);

    const configs = await prisma.staffLoanWorkflowConfig.findMany({ where: { OR: [{ kind: 'LOAN', isActive: true }, { loans: { some: { status: { in: ['SUBMITTED', 'APPROVED', 'RETURNED'] } } } }] }, include: workflowInclude });
    const approval: Prisma.StaffLoanWhereInput[] = [], disbursement: Prisma.StaffLoanWhereInput[] = [];
    for (const config of configs) {
        for (const stage of config.stages) {
            const scope = stage.role.isActive ? roleBranchScope(actor, stage.roleId) : null;
            if (scope) approval.push({ AND: [scope, { workflowConfigId: config.id, currentApprovalLevel: stage.levelOrder, status: 'SUBMITTED', employeeId: { not: actor.userId } }] });
        }
        for (const role of config.disbursementRoles) {
            const scope = role.isActive ? roleBranchScope(actor, role.id) : null;
            if (scope) disbursement.push({ AND: [scope, { workflowConfigId: config.id, status: 'APPROVED', employeeId: { not: actor.userId } }] });
        }
    }
    // An admin keeps full disbursement rights; approval, by contrast, follows the workflow's stage roles only.
    if (actor.isAdmin) disbursement.push({ AND: [branchScope, { status: 'APPROVED', employeeId: { not: actor.userId } }] });
    const capabilities: ManagementCapabilities = { register: register !== null, approvals: approval.length > 0, disbursements: disbursement.length > 0 };
    return { capabilities, register, approval: { OR: approval }, disbursement: { OR: disbursement } };
}

export async function listApplications(actor: StaffLoanActor, tab: 'own' | 'register' | 'approvals' | 'disbursements', page: number) {
    const scopes = await managementScopes(actor);
    if (tab !== 'own' && !scopes.capabilities[tab]) throw new StaffLoanConfigurationError('You are not assigned access to this loan management tab.', 403);
    const where: Prisma.StaffLoanWhereInput = tab === 'own' ? { employeeId: actor.userId }
        : tab === 'register' ? scopes.register! : tab === 'approvals' ? scopes.approval : scopes.disbursement;
    const pageSize = 20;
    const [items, total] = await prisma.$transaction([
        prisma.staffLoan.findMany({ where, include: loanInclude, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize }),
        prisma.staffLoan.count({ where }),
    ]);
    const employeeIds = [...new Set(items.map(row => row.employeeId))];
    const grouped = employeeIds.length ? (await prisma.staffLoan.groupBy?.({
        by: ['employeeId', 'status'],
        where: { employeeId: { in: employeeIds }, status: { in: ['SUBMITTED', 'RETURNED', 'APPROVED', 'ACTIVE', 'CLOSED'] } },
        _count: { _all: true },
    })) ?? [] : [];
    const counts = new Map<string, { total: number; completed: number }>();
    for (const g of grouped) {
        const entry = counts.get(g.employeeId) ?? { total: 0, completed: 0 };
        entry.total += g._count._all;
        if (g.status === 'CLOSED') entry.completed += g._count._all;
        counts.set(g.employeeId, entry);
    }
    const salaryConfig = tab === 'disbursements'
        ? await prisma.staffLoanWorkflowConfig.findFirst({ where: { kind: 'LOAN' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { salaryDay: true } })
        : null;
    return {
        // The register is read-only: decisions are taken only from the Approvals tab.
        items: items.map(row => ({
            ...serialize(row, actor), ...(tab === 'register' ? { canReview: false } : {}),
            totalLoans: counts.get(row.employeeId)?.total ?? 0, completedLoans: counts.get(row.employeeId)?.completed ?? 0,
        })),
        total, page, pageSize, capabilities: scopes.capabilities,
        salaryDay: salaryConfig?.salaryDay ?? null,
    };
}
export async function managementCapabilities(actor: StaffLoanActor) { return (await managementScopes(actor)).capabilities; }

// Who may see one loan: the applicant, the register scope, and the current approval/disbursement queues.
// Prisma treats an empty filter object inside OR as "match nothing", so an unrestricted scope (an admin's
// register scope is {}) must short-circuit instead of being listed as an OR branch.
function loanVisibility(actor: StaffLoanActor, scopes: Awaited<ReturnType<typeof managementScopes>>, id: string): Prisma.StaffLoanWhereInput {
    const clauses: Prisma.StaffLoanWhereInput[] = [{ employeeId: actor.userId }, ...(scopes.register ? [scopes.register] : []), scopes.approval, scopes.disbursement];
    return clauses.some(c => Object.keys(c).length === 0) ? { id } : { id, OR: clauses };
}

export async function loadEmployeeProfile(employeeId: string): Promise<EmployeeProfileDetail> {
    const user = await prisma.user.findUnique({ where: { id: employeeId }, select: {
        id: true, employeeId: true, firstName: true, lastName: true, isActive: true, role: true,
        dateOfJoining: true, dateOfExit: true, confirmationDate: true,
        branch: { select: { name: true } }, department: { select: { name: true } }, designation: { select: { name: true } },
    } });
    if (!user) throw new StaffLoanConfigurationError('Employee not found', 404);
    const [salary, ctc] = await Promise.all([
        prisma.employeeSalaryMaster?.findMany({
            where: { employeeId, isActive: true, salaryComponent: { isActive: true } },
            select: { amount: true, salaryComponent: { select: { name: true, type: true } } },
            orderBy: { salaryComponent: { name: 'asc' } },
        }) ?? [],
        prisma.employeeCtcMaster?.findUnique({ where: { employeeId }, select: { monthlyCtc: true } }) ?? null,
    ]);
    const today = getKolkataCalendarYmd(new Date());
    const joined = user.dateOfJoining ? getKolkataCalendarYmd(user.dateOfJoining) : null;
    return {
        id: user.id, name: `${user.firstName} ${user.lastName}`.trim(), employeeId: user.employeeId,
        dateOfJoining: joined,
        experience: joined ? formatServicePeriod(Math.max(serviceMonths(joined, today), 0)) : '—',
        department: user.department?.name ?? null,
        designation: user.designation?.name ?? user.role,
        branch: user.branch?.name ?? null,
        employmentStatus: user.dateOfExit ? 'Exited' : user.isActive ? 'Active' : 'Inactive',
        confirmationDate: user.confirmationDate ? getKolkataCalendarYmd(user.confirmationDate) : null,
        grossSalary: salary.filter(r => r.salaryComponent.type === 'EARNINGS').reduce((sum, r) => sum.plus(r.amount), new Prisma.Decimal(0)).toNumber(),
        monthlyCtc: ctc ? Number(ctc.monthlyCtc) : null,
        salaryComponents: salary.map(r => ({ name: r.salaryComponent.name, type: r.salaryComponent.type, amount: Number(r.amount) })),
    };
}

async function loadPastLoans(employeeId: string, excludeLoanId: string): Promise<PastLoanRow[]> {
    const rows = await prisma.staffLoan.findMany({
        where: { employeeId, id: { not: excludeLoanId }, status: { notIn: ['DRAFT', 'CANCELLED'] } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 50,
        include: { schedules: { orderBy: { installmentNo: 'asc' }, include: { allocations: { where: { transaction: { status: 'POSTED' } }, select: { principal: true, interest: true, transaction: { select: { transactionDate: true } } } } } } },
    });
    return rows.map(r => {
        const principal = Number(r.approvedAmount ?? r.requestedAmount);
        const terms = loanTerms(principal, r.tenureMonths, r.interestType, Number(r.annualInterestRate));
        const disbursed = r.schedules.length > 0;
        const paid = r.schedules.reduce((sum, sch) => sch.allocations.reduce((inner, a) => inner.plus(a.principal).plus(a.interest), sum), new Prisma.Decimal(0));
        return {
            id: r.id, loanNumber: r.loanNumber, loanDate: (r.disbursedAt ?? r.submittedAt ?? r.createdAt).toISOString(),
            loanAmount: principal, interestAmount: terms.interestAmount, totalPayable: terms.totalPayable, tenureMonths: r.tenureMonths,
            paidAmount: disbursed ? paid.toNumber() : null,
            outstandingAmount: disbursed ? totalOutstanding(r.schedules).total.toNumber() : null,
            status: r.status, closedAt: r.closedAt ? r.closedAt.toISOString() : null,
            // Each loan carries its own track, so the modal can show them one by one rather than merged.
            schedules: disbursed ? computeRepayment(r.schedules).schedules : null,
        };
    });
}

export async function applicationDetail(actor: StaffLoanActor, id: string): Promise<ApplicationDetail> {
    const scopes = await managementScopes(actor);
    const row = await prisma.staffLoan.findFirst({ where: loanVisibility(actor, scopes, id),
        include: {
            ...loanInclude,
            decisions: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], include: { actedBy: { select: { firstName: true, lastName: true } } } },
            schedules: { orderBy: { installmentNo: 'asc' }, include: { allocations: { where: { transaction: { status: 'POSTED' } }, select: { principal: true, interest: true, transaction: { select: { transactionDate: true } } } } } },
        } });
    if (!row) throw new StaffLoanConfigurationError('Loan not found', 404);
    const [employee, pastLoans] = await Promise.all([loadEmployeeProfile(row.employeeId), loadPastLoans(row.employeeId, row.id)]);
    const repayment = row.schedules.length ? computeRepayment(row.schedules) : null;
    const editOptions = row.status === 'SUBMITTED' && reviewerStage(row, actor) ? { schemes: await loadEditSchemes(actor, row) } : null;
    return { ...serialize(row, actor),
        employee, pastLoans, editOptions,
        disbursedAt: row.disbursedAt ? row.disbursedAt.toISOString() : null,
        disbursementStatus: row.disbursedAt ? 'Disbursed' as const : row.status === 'APPROVED' ? 'Awaiting disbursement' as const : 'Not disbursed' as const,
        repayment: repayment ? {
            paidAmount: repayment.totalPrincipalPaid.plus(repayment.totalInterestPaid).toNumber(),
            outstandingAmount: repayment.totalOutstanding.toNumber(),
            remainingPrincipal: repayment.principalOutstanding.toNumber(),
            schedules: repayment.schedules,
        } : null, stages: row.workflowConfig?.stages.map(s => ({ levelOrder: s.levelOrder, stageName: s.stageName, roleName: s.role.name })) ?? [],
        decisions: row.decisions.map(d => ({ id: d.id, action: d.action, stageName: d.stageName, remarks: d.remarks, actorName: `${d.actedBy.firstName} ${d.actedBy.lastName}`, createdAt: d.createdAt.toISOString() })),
        preview: previewInstallments(Number(row.approvedAmount ?? row.requestedAmount), row.tenureMonths, row.interestType, Number(row.annualInterestRate)) };
}

export async function staffLoanDocumentAccess(actor: StaffLoanActor, id: string) {
    const scopes = await managementScopes(actor);
    const row = await prisma.staffLoan.findFirst({ where: loanVisibility(actor, scopes, id),
        select: { documentKey: true, documentName: true, documentMimeType: true } });
    if (!row) throw new StaffLoanConfigurationError('Loan not found', 404);
    if (!row.documentKey) throw new StaffLoanConfigurationError('No document is attached to this application.', 404);
    return { url: await getSignedReadUrl(row.documentKey), fileName: row.documentName ?? 'Document', mimeType: row.documentMimeType ?? '' };
}

export async function reviewApplication(actor: StaffLoanActor, input: { id: string; expectedVersion: number; action: 'APPROVE' | 'REJECT'; remarks: string }) {
    return prisma.$transaction(async tx => {
        const row = await tx.staffLoan.findUnique({ where: { id: input.id }, include: loanInclude });
        if (!row) throw new StaffLoanConfigurationError('Loan not found', 404);
        const stage = row.workflowConfig?.stages.find(s => s.levelOrder === row.currentApprovalLevel);
        // Only the role of the current stage, within its branch, may decide: an admin has no shortcut around the workflow.
        if (!stage || !stage.role.isActive || row.employeeId === actor.userId || !actorRoleCanAct(actor, stage.roleId, row.branchId)) {
            throw new StaffLoanConfigurationError('You are not authorized to review this application.', 403);
        }
        if (row.version !== input.expectedVersion || row.status !== 'SUBMITTED') throw new StaffLoanConfigurationError('Application is no longer awaiting this review. Reload the queue.', 409);
        if (input.action !== 'APPROVE' && !input.remarks.trim()) throw new StaffLoanConfigurationError('Enter a reason for this decision.');
        const next = row.workflowConfig!.stages.find(s => s.levelOrder === stage.levelOrder + 1);
        const finalApproval = input.action === 'APPROVE' && !next;
        const changed = await tx.staffLoan.updateMany({ where: { id: row.id, version: input.expectedVersion, status: 'SUBMITTED' }, data: {
            status: input.action === 'REJECT' ? 'REJECTED' : finalApproval ? 'APPROVED' : 'SUBMITTED',
            currentApprovalLevel: input.action === 'APPROVE' && next ? next.levelOrder : null,
            ...(finalApproval ? { approvedAmount: row.requestedAmount, approvedAt: new Date() } : {}), version: { increment: 1 },
        } });
        if (changed.count !== 1) throw new StaffLoanConfigurationError('Another reviewer changed this application. Reload the queue.', 409);
        await tx.staffLoanDecision.create({ data: { loanId: row.id, action: input.action, stageOrder: stage.levelOrder, stageName: stage.stageName, actedById: actor.userId, remarks: input.remarks.trim() || null } });
        return { status: input.action === 'APPROVE' ? finalApproval ? 'APPROVED' : 'SUBMITTED' : 'REJECTED' };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

// The review stage this actor may act on for a loan under review, or null. Same rule as the review
// action: the current-stage role within the loan's branch, never the borrower (and never an admin by role alone).
function reviewerStage(row: LoanRow, actor: StaffLoanActor) {
    const stage = row.workflowConfig?.stages.find(s => s.levelOrder === row.currentApprovalLevel);
    if (!stage || !stage.role.isActive || row.employeeId === actor.userId) return null;
    return actorRoleCanAct(actor, stage.roleId, row.branchId) ? stage : null;
}

// Whose folder a reviewer's replacement document goes into: the borrower's, and only for a loan the
// reviewer may currently edit. Lets an approver upload without holding "apply for others" rights.
export async function documentUploadTargetForReviewer(actor: StaffLoanActor, loanId: string) {
    const row = await prisma.staffLoan.findUnique({ where: { id: loanId }, include: loanInclude });
    if (!row) throw new StaffLoanConfigurationError('Loan not found', 404);
    if (row.status !== 'SUBMITTED' || !reviewerStage(row, actor)) throw new StaffLoanConfigurationError('You are not authorized to change this application\'s document.', 403);
    return row.employeeId;
}

// Every application detail may be corrected by the current-stage reviewer (or admin) while the loan is
// under review. The change is validated against the (possibly new) scheme, the scheme snapshot is
// refreshed when the scheme changes, and one EDIT decision records who changed what.
export async function editApplicationTerms(actor: StaffLoanActor, id: string, input: EditTermsInput) {
    const data = editTermsSchema.parse(input);
    const preRow = await prisma.staffLoan.findUnique({ where: { id }, select: { employeeId: true } });
    const documentFields = data.document && preRow ? await verifyDocument(preRow.employeeId, data.document) : null;
    return prisma.$transaction(async tx => {
        const row = await tx.staffLoan.findUnique({ where: { id }, include: loanInclude });
        if (!row) throw new StaffLoanConfigurationError('Loan not found', 404);
        const stage = reviewerStage(row, actor);
        if (!stage) throw new StaffLoanConfigurationError('You are not authorized to edit this application.', 403);
        if (row.status !== 'SUBMITTED' || row.version !== data.expectedVersion) throw new StaffLoanConfigurationError('Application is no longer awaiting this review. Reload the queue.', 409);

        const schemeChanged = data.schemeId !== row.schemeId;
        const scheme = await tx.staffLoanScheme.findUnique({ where: { id: data.schemeId }, include: schemeInclude });
        if (!scheme) throw new StaffLoanConfigurationError('The loan scheme is no longer available.', 404);
        if (schemeChanged && !scheme.isActive) throw new StaffLoanConfigurationError('This scheme is unavailable. Select an active scheme.');
        if (data.tenureMonths > scheme.maximumTenureMonths) throw new StaffLoanConfigurationError(`Tenure exceeds the scheme limit of ${scheme.maximumTenureMonths} months.`);
        const employee = await tx.user.findUnique({ where: { id: row.employeeId }, select: employeeSelect });
        if (!employee) throw new StaffLoanConfigurationError('Employee not found', 404);
        const check = await eligibility(tx, scheme, employee, actor, row.id);
        if (schemeChanged && check.error) throw new StaffLoanConfigurationError(check.error);
        if (check.maximumAmount !== null && data.requestedAmount > check.maximumAmount) {
            throw new StaffLoanConfigurationError(`Amount exceeds the scheme limit of ₹${check.maximumAmount.toLocaleString('en-IN')}.`);
        }

        const money = (n: number) => `₹${n.toLocaleString('en-IN')}`;
        const interestLabel = (type: string) => type === 'INTEREST_FREE' ? 'Interest-free' : type === 'MONTHLY' ? 'Monthly' : 'Flat';
        const recoveryLabel = (method: string) => method === 'SALARY' ? 'Salary deduction' : 'Cash / Bank';
        const changes: string[] = [];
        if (schemeChanged) changes.push(`Scheme ${(row.schemeSnapshot as { name?: string }).name ?? row.schemeId} → ${scheme.name}`);
        if (data.requestedAmount !== Number(row.requestedAmount)) changes.push(`Amount ${money(Number(row.requestedAmount))} → ${money(data.requestedAmount)}`);
        if (data.tenureMonths !== row.tenureMonths) changes.push(`Tenure ${row.tenureMonths} → ${data.tenureMonths} months`);
        if (data.interestType !== row.interestType) changes.push(`Interest type ${interestLabel(row.interestType)} → ${interestLabel(data.interestType)}`);
        if (data.annualInterestRate !== Number(row.annualInterestRate)) changes.push(`Interest rate ${Number(row.annualInterestRate)}% → ${data.annualInterestRate}%`);
        if (data.recoveryMethod !== row.recoveryMethod) changes.push(`Recovery ${recoveryLabel(row.recoveryMethod)} → ${recoveryLabel(data.recoveryMethod)}`);
        if (data.purpose !== row.purpose) changes.push('Purpose updated');
        if (data.remarks !== (row.remarks ?? '')) changes.push('Applicant remarks updated');
        if (documentFields && documentFields.documentKey !== row.documentKey) changes.push(`Document replaced (${documentFields.documentName})`);
        if (!changes.length) throw new StaffLoanConfigurationError('No changes to save.');

        const changed = await tx.staffLoan.updateMany({ where: { id: row.id, version: data.expectedVersion, status: 'SUBMITTED' }, data: {
            schemeId: scheme.id,
            ...(schemeChanged ? { schemeVersion: scheme.version, schemeSnapshot: schemeSnapshot(scheme), eligibilitySnapshot: check } : {}),
            requestedAmount: new Prisma.Decimal(String(data.requestedAmount)),
            tenureMonths: data.tenureMonths,
            interestType: data.interestType,
            annualInterestRate: new Prisma.Decimal(String(data.annualInterestRate)),
            recoveryMethod: data.recoveryMethod,
            purpose: data.purpose,
            remarks: data.remarks,
            ...(documentFields ?? {}),
            version: { increment: 1 },
        } });
        if (changed.count !== 1) throw new StaffLoanConfigurationError('Another reviewer changed this application. Reload the queue.', 409);
        await tx.staffLoanDecision.create({ data: {
            loanId: row.id, action: 'EDIT', stageOrder: stage.levelOrder, stageName: stage.stageName, actedById: actor.userId,
            remarks: changes.join('; ') + (data.reason ? ` — ${data.reason}` : ''),
        } });
        return serialize(await tx.staffLoan.findUniqueOrThrow({ where: { id: row.id }, include: loanInclude }), actor);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

// Schemes a reviewer can move a loan to: every active scheme plus the loan's current one, each with the
// eligibility result for THIS employee (service months, minimum salary, limits).
async function loadEditSchemes(actor: StaffLoanActor, row: LoanRow): Promise<ApplicationOption[]> {
    const employee = await prisma.user.findUnique({ where: { id: row.employeeId }, select: employeeSelect });
    if (!employee) return [];
    const schemes = await prisma.staffLoanScheme.findMany({ where: { OR: [{ isActive: true }, { id: row.schemeId }] }, include: schemeInclude, orderBy: { name: 'asc' } });
    const options: ApplicationOption[] = [];
    for (const s of schemes) {
        const check = await eligibility(prisma, s, employee, actor, row.id);
        options.push({ id: s.id, name: s.name, code: s.code, maximumAmount: check.maximumAmount, maximumTenureMonths: s.maximumTenureMonths,
            minimumServiceMonths: s.minimumServiceMonths, minimumSalaryPerMonth: Number(s.minimumSalaryPerMonth), maximumActiveLoans: s.maximumActiveLoans,
            interestType: s.interestType, annualInterestRate: Number(s.annualInterestRate), recoveryMethods: ['SALARY', 'CASH_BANK'], eligibilityError: check.error });
    }
    return options;
}

export async function cancelApplication(actor: StaffLoanActor, id: string, expectedVersion: number) {
    return prisma.$transaction(async tx => {
        const result = await tx.staffLoan.updateMany({ where: { id, employeeId: actor.userId, version: expectedVersion, status: { in: ['DRAFT', 'RETURNED', 'SUBMITTED'] } }, data: { status: 'CANCELLED', currentApprovalLevel: null, version: { increment: 1 } } });
        if (result.count !== 1) throw new StaffLoanConfigurationError('Application changed or can no longer be cancelled.', 409);
        await tx.staffLoanDecision.create({ data: { loanId: id, action: 'CANCEL', actedById: actor.userId } });
        return { status: 'CANCELLED' };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function disburseLoan(actor: StaffLoanActor, input: DisburseInput) {
    const data = disburseSchema.parse(input);
    return prisma.$transaction(async tx => {
        const row = await tx.staffLoan.findUnique({
            where: { id: data.id },
            include: { ...loanInclude, workflowConfig: { include: workflowInclude } },
        });
        if (!row || row.status !== 'APPROVED') {
            throw new StaffLoanConfigurationError('Loan is not approved or ready for disbursement.', 400);
        }
        if (row.version !== data.expectedVersion) {
            throw new StaffLoanConfigurationError('Loan record has changed. Please reload.', 409);
        }

        const disbursementRoles = row.workflowConfig?.disbursementRoles.filter(r => r.isActive) ?? [];
        const isAuthorized = actor.isAdmin || disbursementRoles.some(r => actorRoleCanAct(actor, r.id, row.branchId));
        if (!isAuthorized) {
            throw new StaffLoanConfigurationError('You are not authorized to disburse this loan.', 403);
        }

        const employee = await tx.user.findUnique({ where: { id: row.employeeId }, select: employeeSelect });
        if (!employee?.isActive || !employee.branchId || !employee.branch?.isActive) {
            throw new StaffLoanConfigurationError('Employee is no longer active or assigned to an active branch.', 400);
        }

        const disbursementAmount = row.approvedAmount ?? row.requestedAmount;
        const months = row.tenureMonths;
        const principal = new Prisma.Decimal(disbursementAmount);
        const interest = totalFlatInterest(principal, months, row.interestType, Number(row.annualInterestRate));
        const principalPaise = principal.mul(100).toDecimalPlaces(0);
        const interestPaise = interest.mul(100).toDecimalPlaces(0);
        const basePrincipal = principalPaise.div(months).floor();
        const baseInterest = interestPaise.div(months).floor();
        const extraPrincipal = principalPaise.mod(months).toNumber();
        const extraInterest = interestPaise.mod(months).toNumber();

        // Due dates follow the salary date from the workflow master (latest setting wins, so loans approved
        // before a change still use the current payroll date): salary day of each month, the day before
        // when it is a Sunday. Without a salary date the first due date is entered manually (legacy).
        const latestConfig = await tx.staffLoanWorkflowConfig.findFirst({ where: { kind: 'LOAN' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { salaryDay: true } });
        const salaryDay = latestConfig?.salaryDay ?? row.workflowConfig?.salaryDay ?? null;
        let dueDates: Date[];
        if (isValidSalaryDay(salaryDay)) {
            const ymds = buildSalaryDueDates(data.disbursementDate, data.firstDueMonth ?? 'NEXT_MONTH', salaryDay, months);
            if (ymds[0] < data.disbursementDate) {
                throw new StaffLoanConfigurationError('The salary date for this month has already passed. Choose "Next month" for the first due date.');
            }
            dueDates = ymds.map(ymd => new Date(ymd));
        } else {
            if (!data.firstDueDate) throw new StaffLoanConfigurationError('Enter the first due date.');
            dueDates = Array.from({ length: months }, (_, i) => {
                const dueDate = new Date(data.firstDueDate as string);
                dueDate.setMonth(dueDate.getMonth() + i);
                return dueDate;
            });
        }
        const firstDate = dueDates[0];
        const schedules = [];
        for (let i = 0; i < months; i++) {
            const dueDate = dueDates[i];
            const p = basePrincipal.plus(i < extraPrincipal ? 1 : 0).div(100);
            const intDue = baseInterest.plus(i < extraInterest ? 1 : 0).div(100);
            schedules.push({
                loanId: row.id,
                installmentNo: i + 1,
                dueDate,
                principalDue: p,
                interestDue: intDue,
            });
        }

        await tx.staffLoanSchedule.createMany({ data: schedules });

        const disbDate = new Date(data.disbursementDate);
        await tx.staffLoanTransaction.create({
            data: {
                loanId: row.id,
                type: 'DISBURSEMENT',
                status: 'POSTED',
                transactionDate: disbDate,
                amount: disbursementAmount,
                paymentMode: data.paymentMode,
                reference: data.reference || null,
                remarks: data.remarks || null,
                idempotencyKey: `DISB-${row.id}-${randomUUID()}`,
                createdById: actor.userId,
                postedAt: new Date(),
            },
        });

        const updated = await tx.staffLoan.updateMany({
            where: { id: row.id, version: data.expectedVersion, status: 'APPROVED' },
            data: {
                status: 'ACTIVE',
                disbursedAt: disbDate,
                firstDueDate: firstDate,
                version: { increment: 1 },
            },
        });
        if (updated.count !== 1) {
            throw new StaffLoanConfigurationError('Disbursement collision. Reload before proceeding.', 409);
        }

        return { status: 'ACTIVE', loanNumber: row.loanNumber };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function listActiveLoansForRepayment(actor: StaffLoanActor, search?: string) {
    const scope = registerScope(actor);
    if (!scope) return [];

    const searchFilter: Prisma.StaffLoanWhereInput = search?.trim() ? {
        OR: [
            { loanNumber: { contains: search.trim(), mode: 'insensitive' } },
            { employee: { firstName: { contains: search.trim(), mode: 'insensitive' } } },
            { employee: { lastName: { contains: search.trim(), mode: 'insensitive' } } },
            { employee: { employeeId: { contains: search.trim(), mode: 'insensitive' } } },
        ],
    } : {};

    const rows = await prisma.staffLoan.findMany({
        where: {
            ...scope,
            status: 'ACTIVE',
            ...searchFilter,
        },
        include: {
            employee: { select: { firstName: true, lastName: true, employeeId: true } },
            branch: { select: { name: true } },
            scheme: { select: { name: true } },
            schedules: {
                include: {
                    allocations: {
                        where: { transaction: { status: 'POSTED' } },
                        select: { principal: true, interest: true },
                    },
                },
            },
        },
        orderBy: { disbursedAt: 'desc' },
        take: 50,
    });

    return rows.map(r => {
        let totalDue = new Prisma.Decimal(0);
        let totalPaid = new Prisma.Decimal(0);
        for (const s of r.schedules) {
            totalDue = totalDue.plus(s.principalDue).plus(s.interestDue);
            for (const a of s.allocations) {
                totalPaid = totalPaid.plus(a.principal).plus(a.interest);
            }
        }
        const totalOutstanding = Prisma.Decimal.max(0, totalDue.minus(totalPaid));
        return {
            id: r.id,
            loanNumber: r.loanNumber,
            employeeName: `${r.employee.firstName} ${r.employee.lastName}`.trim(),
            employeeCode: r.employee.employeeId,
            branchName: r.branch.name,
            schemeName: r.scheme.name,
            disbursedAt: r.disbursedAt ? r.disbursedAt.toISOString().split('T')[0] : null,
            principalAmount: Number(r.approvedAmount ?? r.requestedAmount),
            totalOutstanding: totalOutstanding.toNumber(),
            status: r.status,
            version: r.version,
        };
    });
}

type RepaymentScheduleInput = {
    id: string; installmentNo: number; dueDate: Date;
    principalDue: Prisma.Decimal | number | string; interestDue: Prisma.Decimal | number | string;
    /** Interest an early settlement waived for this installment (see StaffLoanSchedule.interestWaived). */
    interestWaived?: Prisma.Decimal | number | string | null;
    allocations: { principal: Prisma.Decimal | number | string; interest: Prisma.Decimal | number | string; transaction?: { transactionDate: Date } | null }[];
};

// One place that turns a loan's schedule rows + posted allocations into the repayment track and
// totals — shared by the repayment screen and the loan detail view so they can never disagree.
// Interest an early settlement waived is recorded on the installment (interestWaived): it is not owed any more, so an
// installment whose principal and remaining interest are settled reads PAID (never PARTIAL) with no balance left.
export function computeRepayment(rawSchedules: RepaymentScheduleInput[]) {
    const today = new Date(getKolkataCalendarYmd(new Date()));

    let totalPrincipalDue = new Prisma.Decimal(0);
    let totalInterestDue = new Prisma.Decimal(0);
    let totalPrincipalPaid = new Prisma.Decimal(0);
    let totalInterestPaid = new Prisma.Decimal(0);
    let totalInterestWaived = new Prisma.Decimal(0);

    let nextInstallmentAmount: number | null = null;
    let nextDueDate: string | null = null;
    let settlementPayableInterest = new Prisma.Decimal(0);
    let settlementWaivedInterest = new Prisma.Decimal(0);

    const schedules: ScheduleRow[] = rawSchedules.map(s => {
        const pDue = new Prisma.Decimal(s.principalDue);
        const iDue = new Prisma.Decimal(s.interestDue);
        const tDue = pDue.plus(iDue);

        let pPaid = new Prisma.Decimal(0);
        let iPaid = new Prisma.Decimal(0);
        let paymentDate: Date | null = null;
        for (const a of s.allocations) {
            pPaid = pPaid.plus(a.principal);
            iPaid = iPaid.plus(a.interest);
            const paidOn = a.transaction?.transactionDate;
            if (paidOn && (!paymentDate || paidOn > paymentDate)) paymentDate = paidOn;
        }
        const tPaid = pPaid.plus(iPaid);

        const pRem = Prisma.Decimal.max(0, pDue.minus(pPaid));
        const iWaived = new Prisma.Decimal(s.interestWaived ?? 0);
        const iRem = Prisma.Decimal.max(0, iDue.minus(iPaid).minus(iWaived));
        const tRem = pRem.plus(iRem);

        totalPrincipalDue = totalPrincipalDue.plus(pDue);
        totalInterestDue = totalInterestDue.plus(iDue);
        totalPrincipalPaid = totalPrincipalPaid.plus(pPaid);
        totalInterestPaid = totalInterestPaid.plus(iPaid);
        totalInterestWaived = totalInterestWaived.plus(iWaived);

        const isFullyPaid = tRem.lessThanOrEqualTo(0.001);
        const sDueDateStr = s.dueDate.toISOString().split('T')[0];
        const sDueDate = new Date(sDueDateStr);
        const isPastDue = sDueDate < today;

        let status: 'PAID' | 'PARTIAL' | 'PENDING' | 'OVERDUE' = 'PENDING';
        if (isFullyPaid) {
            status = 'PAID';
        } else if (tPaid.greaterThan(0)) {
            status = 'PARTIAL';
        } else if (isPastDue) {
            status = 'OVERDUE';
        }

        if (!isFullyPaid && nextInstallmentAmount === null) {
            nextInstallmentAmount = tRem.toNumber();
            nextDueDate = sDueDateStr;
        }

        if (!isFullyPaid) {
            if (sDueDate <= today) {
                settlementPayableInterest = settlementPayableInterest.plus(iRem);
            } else {
                settlementWaivedInterest = settlementWaivedInterest.plus(iRem);
            }
        }

        return {
            id: s.id,
            installmentNo: s.installmentNo,
            dueDate: sDueDateStr,
            principalDue: pDue.toNumber(),
            interestDue: iDue.toNumber(),
            totalDue: tDue.toNumber(),
            principalPaid: pPaid.toNumber(),
            interestPaid: iPaid.toNumber(),
            totalPaid: tPaid.toNumber(),
            principalOutstanding: pRem.toNumber(),
            interestOutstanding: iRem.toNumber(),
            totalOutstanding: tRem.toNumber(),
            paymentDate: paymentDate ? (paymentDate as Date).toISOString().split('T')[0] : null,
            status,
        };
    });

    const principalOutstanding = Prisma.Decimal.max(0, totalPrincipalDue.minus(totalPrincipalPaid));
    const interestOutstanding = Prisma.Decimal.max(0, totalInterestDue.minus(totalInterestPaid).minus(totalInterestWaived));
    const totalOutstanding = principalOutstanding.plus(interestOutstanding);

    return {
        schedules, totalPrincipalDue, totalInterestDue, totalPrincipalPaid, totalInterestPaid,
        principalOutstanding, interestOutstanding, totalOutstanding, nextInstallmentAmount, nextDueDate,
        settlementPayableInterest, settlementWaivedInterest,
    };
}

export async function getLoanRepaymentDetails(loanId: string, actor: StaffLoanActor): Promise<LoanRepaymentSummary> {
    const row = await prisma.staffLoan.findUnique({
        where: { id: loanId },
        include: {
            employee: { select: { firstName: true, lastName: true, employeeId: true } },
            branch: { select: { name: true } },
            scheme: { select: { name: true } },
            schedules: {
                orderBy: { installmentNo: 'asc' },
                include: {
                    allocations: {
                        where: { transaction: { status: 'POSTED' } },
                        select: { principal: true, interest: true, transaction: { select: { transactionDate: true } } },
                    },
                },
            },
            transactions: {
                orderBy: { createdAt: 'desc' },
                include: {
                    createdBy: { select: { firstName: true, lastName: true } },
                },
            },
        },
    });

    if (!row) {
        throw new StaffLoanConfigurationError('Loan not found', 404);
    }
    if (actor.branchIds !== null && !actor.branchIds.includes(row.branchId) && !actor.isAdmin) {
        throw new StaffLoanConfigurationError('You do not have access to loans in this branch.', 403);
    }

    const {
        schedules, totalPrincipalDue, totalInterestDue, totalPrincipalPaid, totalInterestPaid,
        principalOutstanding, interestOutstanding, totalOutstanding, nextInstallmentAmount, nextDueDate,
        settlementPayableInterest, settlementWaivedInterest,
    } = computeRepayment(row.schedules);

    const settlementPayoffAmount = principalOutstanding.plus(settlementPayableInterest);

    const transactions: RepaymentTransactionRow[] = row.transactions.map(t => ({
        id: t.id,
        type: t.type,
        status: t.status,
        transactionDate: t.transactionDate.toISOString().split('T')[0],
        amount: Number(t.amount),
        paymentMode: t.paymentMode,
        reference: t.reference,
        remarks: t.remarks,
        createdByName: `${t.createdBy.firstName} ${t.createdBy.lastName}`.trim(),
        createdAt: t.createdAt.toISOString(),
    }));

    return {
        loan: {
            id: row.id,
            loanNumber: row.loanNumber,
            employeeId: row.employeeId,
            employeeName: `${row.employee.firstName} ${row.employee.lastName}`.trim(),
            employeeCode: row.employee.employeeId,
            branchName: row.branch.name,
            schemeName: row.scheme.name,
            status: row.status,
            disbursedAt: row.disbursedAt ? row.disbursedAt.toISOString().split('T')[0] : null,
            principalAmount: Number(row.approvedAmount ?? row.requestedAmount),
            tenureMonths: row.tenureMonths,
            interestType: row.interestType,
            annualInterestRate: Number(row.annualInterestRate),
            recoveryMethod: row.recoveryMethod,
            version: row.version,
        },
        summary: {
            totalPrincipalDue: totalPrincipalDue.toNumber(),
            totalInterestDue: totalInterestDue.toNumber(),
            totalPayable: totalPrincipalDue.plus(totalInterestDue).toNumber(),
            totalPrincipalPaid: totalPrincipalPaid.toNumber(),
            totalInterestPaid: totalInterestPaid.toNumber(),
            totalPaid: totalPrincipalPaid.plus(totalInterestPaid).toNumber(),
            principalOutstanding: principalOutstanding.toNumber(),
            interestOutstanding: interestOutstanding.toNumber(),
            totalOutstanding: totalOutstanding.toNumber(),
            nextInstallmentAmount,
            nextDueDate,
        },
        earlySettlement: {
            outstandingPrincipal: principalOutstanding.toNumber(),
            settlementInterest: settlementPayableInterest.toNumber(),
            waivedInterest: settlementWaivedInterest.toNumber(),
            settlementPayoffAmount: settlementPayoffAmount.toNumber(),
            futureInterestPolicy: 'WAIVE_FUTURE',
        },
        schedules,
        transactions,
    };
}

export async function recordRepayment(input: RepaymentInput, actor: StaffLoanActor) {
    const data = repaymentSchema.parse(input);

    return await prisma.$transaction(async (tx) => {
        const loan = await tx.staffLoan.findUnique({
            where: { id: data.loanId },
            include: {
                schedules: {
                    orderBy: { installmentNo: 'asc' },
                    include: {
                        allocations: {
                            where: { transaction: { status: 'POSTED' } },
                            select: { principal: true, interest: true },
                        },
                    },
                },
            },
        });

        if (!loan) throw new StaffLoanConfigurationError('Loan not found', 404);
        if (loan.status !== 'ACTIVE') throw new StaffLoanConfigurationError('Repayment can only be recorded on ACTIVE loans.', 400);
        if (loan.version !== data.expectedVersion) throw new StaffLoanConfigurationError('Loan was modified by another operation. Please reload.', 409);
        if (actor.branchIds !== null && !actor.branchIds.includes(loan.branchId) && !actor.isAdmin) {
            throw new StaffLoanConfigurationError('You are not authorized to collect repayments for this branch.', 403);
        }

        const outstanding = totalOutstanding(loan.schedules);

        const repayAmount = new Prisma.Decimal(data.amount);
        if (repayAmount.greaterThan(outstanding.total.plus(0.01))) {
            throw new StaffLoanConfigurationError(`Repayment amount ₹${repayAmount} exceeds outstanding balance of ₹${outstanding.total.toFixed(2)}`, 400);
        }

        const paymentDate = new Date(data.paymentDate);
        const txRecord = await tx.staffLoanTransaction.create({
            data: {
                loanId: loan.id,
                type: 'CASH_BANK_RECOVERY',
                status: 'POSTED',
                transactionDate: paymentDate,
                amount: repayAmount,
                paymentMode: data.paymentMode,
                reference: data.reference || null,
                remarks: data.remarks || null,
                idempotencyKey: `REPAY-${loan.id}-${randomUUID()}`,
                createdById: actor.userId,
                postedAt: new Date(),
            },
        });

        await allocateAcrossSchedules(tx, loan.id, loan.schedules, txRecord.id, repayAmount);

        const remainingBalance = Prisma.Decimal.max(0, outstanding.total.minus(repayAmount));
        const isClosed = remainingBalance.lessThanOrEqualTo(0.01);
        const newStatus = isClosed ? 'CLOSED' : 'ACTIVE';

        const updated = await tx.staffLoan.updateMany({
            where: { id: loan.id, version: data.expectedVersion, status: 'ACTIVE' },
            data: {
                status: newStatus,
                closedAt: isClosed ? new Date() : null,
                version: { increment: 1 },
            },
        });
        if (updated.count !== 1) {
            throw new StaffLoanConfigurationError('Repayment collision. Reload before proceeding.', 409);
        }

        return {
            loanNumber: loan.loanNumber,
            transactionId: txRecord.id,
            newStatus,
            remainingBalance: remainingBalance.toNumber(),
        };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function recordEarlySettlement(input: SettlementInput, actor: StaffLoanActor) {
    const data = settlementSchema.parse(input);

    return await prisma.$transaction(async (tx) => {
        const loan = await tx.staffLoan.findUnique({
            where: { id: data.loanId },
            include: {
                // A payroll deduction that is submitted but not yet marked paid still holds allocations against the
                // schedule; settling now and marking it paid later would collect the same installment twice.
                transactions: { where: { status: 'PENDING' }, select: { id: true } },
                schedules: {
                    orderBy: { installmentNo: 'asc' },
                    include: {
                        allocations: {
                            where: { transaction: { status: 'POSTED' } },
                            select: { principal: true, interest: true },
                        },
                    },
                },
            },
        });

        if (!loan) throw new StaffLoanConfigurationError('Loan not found', 404);
        if (loan.status !== 'ACTIVE') throw new StaffLoanConfigurationError('Only ACTIVE loans can be early settled.', 400);
        if (loan.version !== data.expectedVersion) throw new StaffLoanConfigurationError('Loan was modified by another operation. Please reload.', 409);
        if (actor.branchIds !== null && !actor.branchIds.includes(loan.branchId) && !actor.isAdmin) {
            throw new StaffLoanConfigurationError('You are not authorized to settle loans for this branch.', 403);
        }
        if (loan.transactions.length > 0) {
            throw new StaffLoanConfigurationError('A payroll deduction for this loan is still pending. Mark that payroll as paid (or clear it) before settling.', 409);
        }

        // The settlement date decides which interest is already due (payable) and which is future (waived), so it
        // can never be back-dated to waive due interest, post-dated, or fall before the loan was paid out.
        if (data.settlementDate > getKolkataCalendarYmd(new Date())) {
            throw new StaffLoanConfigurationError('Settlement date cannot be in the future.', 400);
        }
        if (loan.disbursedAt && data.settlementDate < loan.disbursedAt.toISOString().split('T')[0]) {
            throw new StaffLoanConfigurationError('Settlement date cannot be before the loan was disbursed.', 400);
        }

        const settlementDate = new Date(data.settlementDate);

        let totalPrincipalRem = new Prisma.Decimal(0);
        let payableInterest = new Prisma.Decimal(0);
        let waivedInterest = new Prisma.Decimal(0);

        const scheduleBalances = loan.schedules.map(s => {
            const pPaid = s.allocations.reduce((acc, a) => acc.plus(a.principal), new Prisma.Decimal(0));
            const iPaid = s.allocations.reduce((acc, a) => acc.plus(a.interest), new Prisma.Decimal(0));
            const pRem = Prisma.Decimal.max(0, new Prisma.Decimal(s.principalDue).minus(pPaid));
            const iRem = Prisma.Decimal.max(0, new Prisma.Decimal(s.interestDue).minus(iPaid).minus(s.interestWaived ?? 0));

            totalPrincipalRem = totalPrincipalRem.plus(pRem);

            const isDueOrPast = s.dueDate <= settlementDate;
            let sPayableInterest = new Prisma.Decimal(0);
            if (isDueOrPast) {
                sPayableInterest = iRem;
                payableInterest = payableInterest.plus(iRem);
            } else {
                waivedInterest = waivedInterest.plus(iRem);
            }

            return {
                scheduleId: s.id,
                pRem,
                iPayable: sPayableInterest,
                // Interest of an installment not yet due: waived, and recorded as such on the installment.
                iWaived: isDueOrPast ? new Prisma.Decimal(0) : iRem,
            };
        });

        const settlementAmount = totalPrincipalRem.plus(payableInterest);
        if (settlementAmount.lessThanOrEqualTo(0)) {
            throw new StaffLoanConfigurationError('This loan has no outstanding balance to settle.', 400);
        }
        if (data.expectedAmount !== undefined && settlementAmount.minus(data.expectedAmount).abs().greaterThan(0.01)) {
            throw new StaffLoanConfigurationError(`The settlement amount has changed to ₹${settlementAmount.toFixed(2)}. Reload before proceeding.`, 409);
        }

        const txRecord = await tx.staffLoanTransaction.create({
            data: {
                loanId: loan.id,
                type: 'EARLY_SETTLEMENT',
                status: 'POSTED',
                transactionDate: settlementDate,
                amount: settlementAmount,
                paymentMode: data.paymentMode,
                reference: data.reference || null,
                remarks: data.remarks || 'Early settlement full payoff',
                idempotencyKey: `SETTLE-${loan.id}-${randomUUID()}`,
                createdById: actor.userId,
                postedAt: new Date(),
            },
        });

        for (const sb of scheduleBalances) {
            if (sb.pRem.greaterThan(0) || sb.iPayable.greaterThan(0)) {
                await tx.staffLoanRepaymentAllocation.create({
                    data: {
                        loanId: loan.id,
                        transactionId: txRecord.id,
                        scheduleId: sb.scheduleId,
                        principal: sb.pRem,
                        interest: sb.iPayable,
                    },
                });
            }
        }

        // Record the waiver on each installment so the settled loan is stored as fully settled, not just implied.
        for (const sb of scheduleBalances) {
            if (sb.iWaived.greaterThan(0)) {
                await tx.staffLoanSchedule.update({ where: { id: sb.scheduleId }, data: { interestWaived: sb.iWaived } });
            }
        }

        const updated = await tx.staffLoan.updateMany({
            where: { id: loan.id, version: data.expectedVersion, status: 'ACTIVE' },
            data: {
                status: 'CLOSED',
                closedAt: new Date(),
                version: { increment: 1 },
            },
        });
        if (updated.count !== 1) {
            throw new StaffLoanConfigurationError('Settlement collision. Reload before proceeding.', 409);
        }

        return {
            loanNumber: loan.loanNumber,
            transactionId: txRecord.id,
            settlementAmount: settlementAmount.toNumber(),
            waivedInterest: waivedInterest.toNumber(),
        };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
