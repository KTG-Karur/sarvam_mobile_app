import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SchemeInput, WorkflowInput } from './configuration';

const db = vi.hoisted(() => {
    const tx = {
        branch: { count: vi.fn() }, department: { count: vi.fn() }, role: { count: vi.fn() }, salaryComponent: { count: vi.fn() },
        staffLoanScheme: { create: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
        staffLoanWorkflowConfig: { findFirst: vi.fn(), update: vi.fn(), create: vi.fn() },
    };
    return { tx, prisma: { $transaction: vi.fn(), staffLoanScheme: tx.staffLoanScheme, staffLoanWorkflowConfig: tx.staffLoanWorkflowConfig } };
});
vi.mock('@/app/lib/db', () => ({ prisma: db.prisma }));
import { saveStaffLoanScheme, saveStaffLoanWorkflow } from './configuration-service';

const scheme: SchemeInput = {
    code: 'TEST', name: 'Test scheme', description: '', minimumServiceMonths: 6, minimumSalaryPerMonth: 0,
    amountBasis: 'FIXED_AMOUNT', maximumAmount: 20000, salaryMultiplier: null,
    maximumTenureMonths: 12, maximumActiveLoans: 1,
    interestType: 'INTEREST_FREE', annualInterestRate: 0,
    isActive: true,
    branchIds: [], departmentIds: [], roleIds: [], salaryBasisComponentIds: [],
};
const workflow: WorkflowInput = { expectedConfigId: 'old', name: 'New review', isActive: true, salaryDay: 7,
    stages: [{ levelOrder: 1, stageName: 'Review', roleId: 'reviewer' }], disbursementRoleIds: ['disburser'] };

beforeEach(() => {
    vi.resetAllMocks();
    db.prisma.$transaction.mockImplementation(async (callback: (tx: typeof db.tx) => unknown) => callback(db.tx));
    db.tx.branch.count.mockResolvedValue(0); db.tx.department.count.mockResolvedValue(0);
    db.tx.role.count.mockResolvedValue(0); db.tx.salaryComponent.count.mockResolvedValue(0);
});

describe('scheme saves', () => {
    it('rejects a stale version without changing applicability relations', async () => {
        db.tx.staffLoanScheme.updateMany.mockResolvedValue({ count: 0 });
        await expect(saveStaffLoanScheme(scheme, 'actor', { id: 'scheme', expectedVersion: 2 })).rejects.toMatchObject({ status: 409 });
        expect(db.tx.staffLoanScheme.update).not.toHaveBeenCalled();
        expect(db.tx.staffLoanScheme.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'scheme', version: 2 } }));
    });
    it('rejects unavailable applicability references before writes', async () => {
        await expect(saveStaffLoanScheme({ ...scheme, branchIds: ['missing'] }, 'actor')).rejects.toThrow('unavailable');
        expect(db.tx.staffLoanScheme.create).not.toHaveBeenCalled();
    });
    it('creates only submitted terms and resolves actor server-side', async () => {
        db.tx.staffLoanScheme.create.mockResolvedValue({ ...scheme, id: 'new', version: 1,
            applicableBranches: [], applicableDepartments: [], applicableRoles: [], salaryBasisComponents: [] });
        const result = await saveStaffLoanScheme(scheme, 'authenticated-actor');
        expect(result.code).toBe('TEST');
        expect(db.tx.staffLoanScheme.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ createdById: 'authenticated-actor', name: scheme.name }) }));
        expect(db.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    });
});

describe('workflow publication', () => {
    it('rejects stale submissions before deactivating the current configuration', async () => {
        db.tx.staffLoanWorkflowConfig.findFirst.mockResolvedValue({ id: 'newer', isActive: true });
        await expect(saveStaffLoanWorkflow(workflow, 'actor')).rejects.toMatchObject({ status: 409 });
        expect(db.tx.staffLoanWorkflowConfig.update).not.toHaveBeenCalled();
        expect(db.tx.staffLoanWorkflowConfig.create).not.toHaveBeenCalled();
    });
    it('keeps old stages and creates a distinct workflow version atomically', async () => {
        db.tx.staffLoanWorkflowConfig.findFirst.mockResolvedValue({ id: 'old', isActive: true });
        db.tx.role.count.mockResolvedValue(2);
        db.tx.staffLoanWorkflowConfig.create.mockResolvedValue({ ...workflow, id: 'new', disbursementRoles: [{ id: 'disburser' }] });
        await saveStaffLoanWorkflow(workflow, 'actor');
        expect(db.tx.staffLoanWorkflowConfig.update).toHaveBeenCalledExactlyOnceWith({ where: { id: 'old' }, data: { isActive: false } });
        expect(db.tx.staffLoanWorkflowConfig.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
            stages: { create: workflow.stages }, disbursementRoles: { connect: [{ id: 'disburser' }] }, salaryDay: 7,
        }) }));
        expect(db.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
    });
    it('rejects a save without a valid salary date before touching the database', async () => {
        await expect(saveStaffLoanWorkflow({ ...workflow, salaryDay: 0 }, 'actor')).rejects.toThrow('Salary date');
        await expect(saveStaffLoanWorkflow({ ...workflow, salaryDay: undefined as unknown as number }, 'actor')).rejects.toThrow('salary date');
        expect(db.prisma.$transaction).not.toHaveBeenCalled();
    });
    it('rejects inactive or missing roles when activating', async () => {
        db.tx.staffLoanWorkflowConfig.findFirst.mockResolvedValue({ id: 'old', isActive: true });
        db.tx.role.count.mockResolvedValue(1);
        await expect(saveStaffLoanWorkflow(workflow, 'actor')).rejects.toThrow('unavailable');
        expect(db.tx.staffLoanWorkflowConfig.update).not.toHaveBeenCalled();
    });
});

describe('separate staff advance workflow', () => {
    // The advance workflow has stages and a disbursement authority, but no salary date.
    const { salaryDay: _unused, ...advanceWorkflow } = workflow;
    void _unused;

    it('loan saves only look at, deactivate and create LOAN configurations', async () => {
        db.tx.staffLoanWorkflowConfig.findFirst.mockResolvedValue({ id: 'old', isActive: true });
        db.tx.role.count.mockResolvedValue(2);
        db.tx.staffLoanWorkflowConfig.create.mockResolvedValue({ ...workflow, id: 'new', disbursementRoles: [] });
        await saveStaffLoanWorkflow(workflow, 'actor');
        expect(db.tx.staffLoanWorkflowConfig.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { kind: 'LOAN' } }));
        expect(db.tx.staffLoanWorkflowConfig.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ kind: 'LOAN', salaryDay: 7 }) }));
    });

    it('an advance save is scoped to ADVANCE, so it never deactivates or replaces the loan workflow', async () => {
        db.tx.staffLoanWorkflowConfig.findFirst.mockResolvedValue({ id: 'old', isActive: true });
        db.tx.role.count.mockResolvedValue(2);
        db.tx.staffLoanWorkflowConfig.create.mockResolvedValue({ ...advanceWorkflow, id: 'new', salaryDay: null, disbursementRoles: [{ id: 'disburser' }] });
        await saveStaffLoanWorkflow(advanceWorkflow, 'actor', 'ADVANCE');
        expect(db.tx.staffLoanWorkflowConfig.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { kind: 'ADVANCE' } }));
        expect(db.tx.staffLoanWorkflowConfig.update).toHaveBeenCalledExactlyOnceWith({ where: { id: 'old' }, data: { isActive: false } });
        expect(db.tx.staffLoanWorkflowConfig.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
            kind: 'ADVANCE', salaryDay: null, stages: { create: advanceWorkflow.stages }, disbursementRoles: { connect: [{ id: 'disburser' }] },
        }) }));
    });

    it('the advance workflow keeps a disbursement authority, exactly like the loan one', async () => {
        await expect(saveStaffLoanWorkflow({ ...advanceWorkflow, disbursementRoleIds: [] }, 'actor', 'ADVANCE')).rejects.toThrow('disbursement role');
        await expect(saveStaffLoanWorkflow({ ...workflow, disbursementRoleIds: [] }, 'actor')).rejects.toThrow('disbursement role');
    });

    it('the advance workflow has no salary date: it is neither required nor accepted', async () => {
        db.tx.staffLoanWorkflowConfig.findFirst.mockResolvedValue(null);
        db.tx.role.count.mockResolvedValue(2);
        db.tx.staffLoanWorkflowConfig.create.mockResolvedValue({ ...advanceWorkflow, id: 'new', salaryDay: null, disbursementRoles: [{ id: 'disburser' }] });
        await expect(saveStaffLoanWorkflow({ ...advanceWorkflow, expectedConfigId: null }, 'actor', 'ADVANCE')).resolves.toMatchObject({ id: 'new', salaryDay: null, disbursementRoleIds: ['disburser'] });
        await expect(saveStaffLoanWorkflow(workflow, 'actor', 'ADVANCE')).rejects.toThrow();
    });

    it('an advance workflow still needs at least one stage', async () => {
        await expect(saveStaffLoanWorkflow({ ...advanceWorkflow, stages: [] }, 'actor', 'ADVANCE')).rejects.toThrow('at least one approval stage');
    });
});
