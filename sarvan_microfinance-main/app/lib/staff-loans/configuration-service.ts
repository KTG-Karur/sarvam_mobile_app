import { Prisma } from '@prisma/client';
import { prisma } from '@/app/lib/db';
import { advanceWorkflowSchema, schemeSchema, workflowSchema, type AdvanceWorkflowInput, type SchemeInput, type WorkflowInput, type WorkflowKind } from './configuration';

export class StaffLoanConfigurationError extends Error {
    constructor(message: string, public readonly status = 400) { super(message); }
}

function requireConfigurationClient() {
    if (!prisma.staffLoanScheme || !prisma.staffLoanWorkflowConfig) {
        throw new StaffLoanConfigurationError('Staff loan configuration is not available yet. Contact your administrator to complete setup.', 503);
    }
}

const schemeInclude = {
    applicableBranches: { select: { id: true } },
    applicableDepartments: { select: { id: true } },
    applicableRoles: { select: { id: true } },
    salaryBasisComponents: { select: { id: true } },
} satisfies Prisma.StaffLoanSchemeInclude;
const workflowInclude = {
    stages: { orderBy: { levelOrder: 'asc' as const } },
    disbursementRoles: { select: { id: true } },
} satisfies Prisma.StaffLoanWorkflowConfigInclude;

function schemeRecord(row: Prisma.StaffLoanSchemeGetPayload<{ include: typeof schemeInclude }>) {
    return {
        ...schemeSchema.parse({
            code: row.code, name: row.name, description: row.description ?? '',
            minimumServiceMonths: row.minimumServiceMonths, minimumSalaryPerMonth: Number(row.minimumSalaryPerMonth), amountBasis: row.amountBasis,
            maximumAmount: row.maximumAmount === null ? null : Number(row.maximumAmount),
            salaryMultiplier: row.salaryMultiplier === null ? null : Number(row.salaryMultiplier),
            maximumTenureMonths: row.maximumTenureMonths, maximumActiveLoans: row.maximumActiveLoans,
            interestType: row.interestType, annualInterestRate: Number(row.annualInterestRate),
            isActive: row.isActive,
            branchIds: row.applicableBranches.map(r => r.id), departmentIds: row.applicableDepartments.map(r => r.id),
            roleIds: row.applicableRoles.map(r => r.id), salaryBasisComponentIds: row.salaryBasisComponents.map(r => r.id),
        }),
        id: row.id, version: row.version,
    };
}
function workflowRecord(row: Prisma.StaffLoanWorkflowConfigGetPayload<{ include: typeof workflowInclude }>) {
    return {
        id: row.id, name: row.name, isActive: row.isActive, salaryDay: row.salaryDay,
        stages: row.stages.map(s => ({ levelOrder: s.levelOrder, stageName: s.stageName, roleId: s.roleId })),
        disbursementRoleIds: row.disbursementRoles.map(r => r.id),
    };
}

export async function listStaffLoanSchemes() {
    requireConfigurationClient();
    const select = { id: true, name: true, isActive: true } as const;
    const [schemes, branches, departments, roles, salaryComponents] = await Promise.all([
        prisma.staffLoanScheme.findMany({ include: schemeInclude, orderBy: { name: 'asc' } }),
        prisma.branch.findMany({ select, orderBy: { name: 'asc' } }),
        prisma.department.findMany({ select, orderBy: { name: 'asc' } }),
        prisma.role.findMany({ select, orderBy: { name: 'asc' } }),
        prisma.salaryComponent.findMany({ where: { type: 'EARNINGS' }, select, orderBy: { name: 'asc' } }),
    ]);
    return { schemes: schemes.map(schemeRecord), options: { branches, departments, roles, salaryComponents } };
}

async function validateSchemeReferences(tx: Prisma.TransactionClient, data: SchemeInput) {
    const active = data.isActive ? { isActive: true } : {};
    const counts = await Promise.all([
        tx.branch.count({ where: { id: { in: data.branchIds }, ...active } }),
        tx.department.count({ where: { id: { in: data.departmentIds }, ...active } }),
        tx.role.count({ where: { id: { in: data.roleIds }, ...active } }),
        tx.salaryComponent.count({ where: { id: { in: data.salaryBasisComponentIds }, type: 'EARNINGS', ...active } }),
    ]);
    const selections = [data.branchIds, data.departmentIds, data.roleIds, data.salaryBasisComponentIds];
    if (counts.some((count, i) => count !== selections[i].length)) {
        throw new StaffLoanConfigurationError('A selected branch, department, role or salary component is unavailable. Reload the options before saving.');
    }
}

export async function saveStaffLoanScheme(input: SchemeInput, actorId: string, update?: { id: string; expectedVersion: number }) {
    requireConfigurationClient();
    const data = schemeSchema.parse(input);
    return prisma.$transaction(async tx => {
        await validateSchemeReferences(tx, data);
        const { branchIds, departmentIds, roleIds, salaryBasisComponentIds, ...fields } = data;
        const scalarData = {
            ...fields,
            maximumAmount: fields.maximumAmount === null ? null : new Prisma.Decimal(String(fields.maximumAmount)),
            salaryMultiplier: fields.salaryMultiplier === null ? null : new Prisma.Decimal(String(fields.salaryMultiplier)),
            annualInterestRate: new Prisma.Decimal(String(fields.annualInterestRate)),
            minimumSalaryPerMonth: new Prisma.Decimal(String(fields.minimumSalaryPerMonth)),
        };
        const connect = (values: string[]) => values.map(id => ({ id }));
        if (!update) {
            const row = await tx.staffLoanScheme.create({ data: {
                ...scalarData, createdById: actorId,
                applicableBranches: { connect: connect(branchIds) },
                applicableDepartments: { connect: connect(departmentIds) },
                applicableRoles: { connect: connect(roleIds) },
                salaryBasisComponents: { connect: connect(salaryBasisComponentIds) },
            }, include: schemeInclude });
            return schemeRecord(row);
        }
        const claimed = await tx.staffLoanScheme.updateMany({
            where: { id: update.id, version: update.expectedVersion },
            data: { ...scalarData, version: { increment: 1 } },
        });
        if (claimed.count !== 1) throw new StaffLoanConfigurationError('This scheme changed or is unavailable. Reload before saving.', 409);
        const row = await tx.staffLoanScheme.update({ where: { id: update.id }, data: {
            applicableBranches: { set: connect(branchIds) },
            applicableDepartments: { set: connect(departmentIds) },
            applicableRoles: { set: connect(roleIds) },
            salaryBasisComponents: { set: connect(salaryBasisComponentIds) },
        }, include: schemeInclude });
        // Existing loans keep their schemeSnapshot; never update them here.
        return schemeRecord(row);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

// Loan and Advance workflows are separate, independently versioned configurations on the same master page.
// Every lookup below is scoped to one kind so saving one never changes the other.
export async function getStaffLoanWorkflow(kind: WorkflowKind = 'LOAN') {
    requireConfigurationClient();
    const [config, roles] = await Promise.all([
        prisma.staffLoanWorkflowConfig.findFirst({ where: { kind }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], include: workflowInclude }),
        prisma.role.findMany({ select: { id: true, name: true, isActive: true }, orderBy: { name: 'asc' } }),
    ]);
    return { config: config ? workflowRecord(config) : null, roles };
}

export async function saveStaffLoanWorkflow(input: WorkflowInput | AdvanceWorkflowInput, actorId: string, kind: WorkflowKind = 'LOAN') {
    requireConfigurationClient();
    // The advance workflow has no salary date; the column stays null for it.
    const data = kind === 'ADVANCE'
        ? { ...advanceWorkflowSchema.parse(input), salaryDay: null }
        : workflowSchema.parse(input);
    return prisma.$transaction(async tx => {
        const latest = await tx.staffLoanWorkflowConfig.findFirst({ where: { kind }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
        if ((latest?.id ?? null) !== data.expectedConfigId) {
            throw new StaffLoanConfigurationError('The workflow changed while you were editing. Reload before saving.', 409);
        }
        const roleIds = [...new Set([...data.stages.map(s => s.roleId), ...data.disbursementRoleIds])];
        const roleCount = await tx.role.count({ where: { id: { in: roleIds }, ...(data.isActive ? { isActive: true } : {}) } });
        if (roleCount !== roleIds.length) throw new StaffLoanConfigurationError('A selected role is unavailable. Reload the roles before saving.');
        if (latest?.isActive) await tx.staffLoanWorkflowConfig.update({ where: { id: latest.id }, data: { isActive: false } });
        const config = await tx.staffLoanWorkflowConfig.create({ data: {
            kind, name: data.name, isActive: data.isActive, salaryDay: data.salaryDay, createdById: actorId,
            stages: { create: data.stages },
            disbursementRoles: { connect: data.disbursementRoleIds.map(id => ({ id })) },
        }, include: workflowInclude });
        // Old stages and role assignments remain intact for in-flight loans and advances.
        return workflowRecord(config);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
