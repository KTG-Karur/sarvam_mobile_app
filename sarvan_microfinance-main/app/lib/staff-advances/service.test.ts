import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db, salaryMock } = vi.hoisted(() => {
    const db: any = {
        user: { findUnique: vi.fn() },
        staffLoanWorkflowConfig: { findFirst: vi.fn(), findMany: vi.fn() },
        staffAdvance: { findFirst: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
        staffAdvanceSchedule: { createMany: vi.fn() },
        staffAdvanceDecision: { create: vi.fn() },
        $queryRaw: vi.fn(),
        $transaction: vi.fn(),
    };
    return { db, salaryMock: { getAdvanceSalarySummary: vi.fn(), loadObligations: vi.fn() } };
});

const docStorage = vi.hoisted(() => ({ isKeyFor: vi.fn(), read: vi.fn() }));
vi.mock('@/app/lib/db', () => ({ prisma: db }));
vi.mock('@/app/lib/storage/staff-loan-document-storage', () => ({ isStaffLoanDocumentKeyFor: docStorage.isKeyFor, readStaffLoanDocument: docStorage.read }));
vi.mock('@/app/lib/storage/gcs-client', () => ({ getSignedReadUrl: vi.fn(async () => 'https://signed.example/doc') }));
vi.mock('./salary', () => salaryMock);
vi.mock('@/app/lib/staff-loans/application-service', () => ({ loadEmployeeProfile: vi.fn() }));

import { advanceDocumentAccess, applyForAdvance, cancelAdvance, disburseAdvance, editAdvance, reviewAdvance } from './service';

const actor = (over: Record<string, unknown> = {}) => ({
    userId: 'emp1', isAdmin: false, isHR: false, branchIds: null, assignments: [], ...over,
}) as any;

const salary = (over: Record<string, unknown> = {}) => ({
    month: 9, year: 2026, monthlyCtc: 40000, basicSalary: 20000, grossSalary: 40000, earnings: [], deductionLines: [],
    totalDeductions: 0, existingLoanDeduction: 0, existingAdvanceDeduction: 0, otherDeductions: 0, currentInHand: 30000, ...over,
});

const stage = (levelOrder: number, roleId = `role${levelOrder}`) => ({
    levelOrder, roleId, stageName: `Stage ${levelOrder}`, role: { name: `Role ${levelOrder}`, isActive: true },
});
const workflow = (stages = [stage(1)], disbursementRoles = [{ id: 'disburser', isActive: true }]) => ({ id: 'wf1', stages, disbursementRoles });

function advanceRecord(over: Record<string, unknown> = {}) {
    return {
        id: 'adv1', advanceNumber: 'SA-000001', employeeId: 'emp1', branchId: 'b1', status: 'SUBMITTED',
        amount: '10000', repaymentMonths: 2, purpose: 'Medical', remarks: null, version: 1,
        currentApprovalLevel: 1, workflowConfigId: 'wf1', salarySnapshot: null,
        createdAt: new Date('2026-09-01T00:00:00Z'), approvedAt: null, disbursedAt: null, paymentMode: null, paymentReference: null, completedAt: null,
        employee: { firstName: 'A', lastName: 'B', employeeId: 'E1', role: 'FDO', department: null, designation: null },
        branch: { name: 'Main' }, workflowConfig: workflow(), schedules: [], ...over,
    };
}

beforeEach(() => {
    vi.clearAllMocks();
    db.$transaction.mockImplementation(async (cb: (tx: any) => unknown) => cb(db));
    salaryMock.getAdvanceSalarySummary.mockResolvedValue(salary());
    db.staffLoanWorkflowConfig.findMany.mockResolvedValue([]);
    docStorage.isKeyFor.mockResolvedValue(true);
    docStorage.read.mockResolvedValue({ buffer: Buffer.from('doc-bytes'), contentType: 'application/pdf' });
});

describe('applyForAdvance', () => {
    const input = { amount: 10000, purpose: 'Medical', remarks: '', document: { fileKey: 'org/employee-emp1/staff-advance/slip.pdf', fileName: 'slip.pdf' } };

    function happyPath() {
        db.user.findUnique.mockResolvedValue({ id: 'emp1', isActive: true, branchId: 'b1', branch: { isActive: true } });
        db.staffLoanWorkflowConfig.findFirst.mockResolvedValue(workflow());
        db.staffAdvance.findFirst.mockResolvedValue(null);
        db.$queryRaw.mockResolvedValue([{ n: BigInt(7) }]);
        db.staffAdvance.create.mockImplementation(async ({ data }: any) => advanceRecord({ advanceNumber: data.advanceNumber, amount: data.amount }));
    }

    it('creates a SUBMITTED advance numbered SA-000007, fixed at 2 months, with a submit history entry', async () => {
        happyPath();
        const row = await applyForAdvance(actor(), input);
        expect(row.advanceNumber).toBe('SA-000007');
        const created = db.staffAdvance.create.mock.calls[0][0].data;
        expect(created).toMatchObject({ advanceNumber: 'SA-000007', status: 'SUBMITTED', repaymentMonths: 2, currentApprovalLevel: 1, employeeId: 'emp1', branchId: 'b1' });
        expect(created.salarySnapshot).toMatchObject({ currentInHand: 30000, monthlyRepayment: 5000, projectedInHand: 25000 });
        expect(db.staffAdvanceDecision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ advanceId: 'adv1', action: 'SUBMIT', actedById: 'emp1' }) });
    });

    it('stores the chosen repayment period, and a one-month advance is judged on the whole amount', async () => {
        happyPath();
        await applyForAdvance(actor(), { ...input, repaymentMonths: 1 });
        expect(db.staffAdvance.create.mock.calls[0][0].data.repaymentMonths).toBe(1);
        expect(db.staffAdvance.create.mock.calls[0][0].data.salarySnapshot).toMatchObject({ monthlyRepayment: 10000, projectedInHand: 20000 });
        // 10000 in one month exceeds an in-hand salary of 8000, although the 5000 half of a two-month split would not
        salaryMock.getAdvanceSalarySummary.mockResolvedValue(salary({ currentInHand: 8000 }));
        await expect(applyForAdvance(actor(), { ...input, repaymentMonths: 1 })).rejects.toThrow(/more than the expected in-hand salary/);
        await expect(applyForAdvance(actor(), { ...input, repaymentMonths: 2 })).resolves.toBeTruthy();
    });

    it('defaults to two months and refuses any other period', async () => {
        happyPath();
        await applyForAdvance(actor(), input);
        expect(db.staffAdvance.create.mock.calls[0][0].data.repaymentMonths).toBe(2);
        await expect(applyForAdvance(actor(), { ...input, repaymentMonths: 3 } as any)).rejects.toThrow();
    });

    it('stores the supporting document with the real type and size read back from storage', async () => {
        happyPath();
        await applyForAdvance(actor(), input);
        expect(docStorage.isKeyFor).toHaveBeenCalledWith('emp1', input.document.fileKey, 'staff-advance');
        expect(db.staffAdvance.create.mock.calls[0][0].data).toMatchObject({
            documentKey: input.document.fileKey, documentName: 'slip.pdf', documentMimeType: 'application/pdf', documentSize: 9,
        });
    });

    it('needs the supporting document, and refuses one outside the applicant staff-advance folder or of a wrong type', async () => {
        happyPath();
        const { document: _omit, ...withoutDocument } = input;
        await expect(applyForAdvance(actor(), withoutDocument as any)).rejects.toThrow();
        docStorage.isKeyFor.mockResolvedValue(false);
        await expect(applyForAdvance(actor(), input)).rejects.toThrow(/document is invalid/);
        docStorage.isKeyFor.mockResolvedValue(true);
        docStorage.read.mockResolvedValue({ buffer: Buffer.from('x'), contentType: 'text/html' });
        await expect(applyForAdvance(actor(), input)).rejects.toThrow(/not an allowed file/);
        expect(db.staffAdvance.create).not.toHaveBeenCalled();
    });

    it('rejects a second advance while one is under review, awaiting disbursement or being repaid', async () => {
        for (const status of ['SUBMITTED', 'APPROVED', 'ACTIVE']) {
            happyPath();
            db.staffAdvance.findFirst.mockResolvedValue({ advanceNumber: 'SA-000003', status });
            await expect(applyForAdvance(actor(), input)).rejects.toMatchObject({ status: 409 });
        }
        expect(db.staffAdvance.create).not.toHaveBeenCalled();
        expect(db.staffAdvance.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: { in: ['SUBMITTED', 'APPROVED', 'ACTIVE'] } }) }));
    });

    it('turns a concurrent duplicate (unique index violation) into a 409', async () => {
        happyPath();
        db.staffAdvance.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
        await expect(applyForAdvance(actor(), input)).rejects.toMatchObject({ status: 409 });
    });

    it('refuses an advance whose first installment would make the in-hand salary negative', async () => {
        happyPath();
        salaryMock.getAdvanceSalarySummary.mockResolvedValue(salary({ currentInHand: 4000 }));
        await expect(applyForAdvance(actor(), input)).rejects.toThrow(/more than the expected in-hand salary/);
        expect(db.staffAdvance.create).not.toHaveBeenCalled();
    });

    it('does not block when the employee has no salary data configured', async () => {
        happyPath();
        salaryMock.getAdvanceSalarySummary.mockResolvedValue(salary({ monthlyCtc: 0, currentInHand: 0 }));
        await expect(applyForAdvance(actor(), input)).resolves.toBeTruthy();
    });

    it('uses the separate Staff Advance workflow, never the staff loan one', async () => {
        happyPath();
        await applyForAdvance(actor(), input);
        expect(db.staffLoanWorkflowConfig.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { kind: 'ADVANCE', isActive: true } }));
    });

    it('needs a configured, active approval workflow', async () => {
        happyPath();
        db.staffLoanWorkflowConfig.findFirst.mockResolvedValue(null);
        await expect(applyForAdvance(actor(), input)).rejects.toThrow(/workflow is not configured/);
    });

    it('needs a disbursement authority in the workflow, like a loan', async () => {
        happyPath();
        db.staffLoanWorkflowConfig.findFirst.mockResolvedValue(workflow([stage(1)], []));
        await expect(applyForAdvance(actor(), input)).rejects.toThrow(/workflow is not configured/);
        db.staffLoanWorkflowConfig.findFirst.mockResolvedValue(workflow([stage(1)], [{ id: 'disburser', isActive: false }]));
        await expect(applyForAdvance(actor(), input)).rejects.toThrow(/workflow is not configured/);
    });

    it('does not let an ordinary user apply for someone else', async () => {
        happyPath();
        await expect(applyForAdvance(actor(), { ...input, employeeId: 'other' })).rejects.toMatchObject({ status: 403 });
    });

    it('does not let a branch-restricted actor apply for an employee of another branch', async () => {
        happyPath();
        await expect(applyForAdvance(actor({ isAdmin: true, branchIds: ['b1'] }), { ...input, employeeId: 'emp2' })).resolves.toBeTruthy();
        await expect(applyForAdvance(actor({ isAdmin: true, branchIds: ['b9'] }), { ...input, employeeId: 'emp2' })).rejects.toMatchObject({ status: 403 });
    });

    it('validates input server-side (3 months, zero amount)', async () => {
        await expect(applyForAdvance(actor(), { ...input, repaymentMonths: 3 } as any)).rejects.toThrow();
        await expect(applyForAdvance(actor(), { ...input, amount: 0 })).rejects.toThrow();
    });
});

describe('reviewAdvance', () => {
    const review = { id: 'adv1', expectedVersion: 1, action: 'APPROVE', remarks: '' };
    // The holder of the stage-1 role at the advance's branch: the only kind of user who may decide.
    const reviewer = () => actor({ userId: 'boss', assignments: [{ roleId: 'role1', branchId: 'b1', pagePermissions: {} }] });

    beforeEach(() => {
        db.staffAdvance.findUnique.mockImplementation(async ({ select }: any) => (select ? { employeeId: 'emp1', amount: '10000' } : advanceRecord()));
        db.staffAdvance.updateMany.mockResolvedValue({ count: 1 });
    });

    it('final approval only marks the advance APPROVED (awaiting disbursement): it is not active and has no schedule yet', async () => {
        const result = await reviewAdvance(reviewer(), review);
        expect(result.status).toBe('APPROVED');
        expect(db.staffAdvanceSchedule.createMany).not.toHaveBeenCalled();
        expect(db.staffAdvance.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'adv1', version: 1, status: 'SUBMITTED' },
            data: expect.objectContaining({ status: 'APPROVED', approvedAt: expect.any(Date) }),
        }));
        expect(db.staffAdvanceDecision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'APPROVE', stageName: 'Stage 1', actedById: 'boss' }) });
    });

    it('an intermediate approval moves to the next stage without creating a schedule', async () => {
        db.staffAdvance.findUnique.mockImplementation(async ({ select }: any) => (select ? { employeeId: 'emp1', amount: '10000' } : advanceRecord({ workflowConfig: workflow([stage(1), stage(2)]) })));
        const result = await reviewAdvance(reviewer(), review);
        expect(result.status).toBe('SUBMITTED');
        expect(db.staffAdvanceSchedule.createMany).not.toHaveBeenCalled();
        expect(db.staffAdvance.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'SUBMITTED', currentApprovalLevel: 2 });
    });

    it('rejection needs a reason, records who/why and creates no schedule', async () => {
        await expect(reviewAdvance(reviewer(), { ...review, action: 'REJECT' })).rejects.toThrow();
        const result = await reviewAdvance(reviewer(), { ...review, action: 'REJECT', remarks: 'Not eligible' });
        expect(result.status).toBe('REJECTED');
        expect(db.staffAdvanceSchedule.createMany).not.toHaveBeenCalled();
        expect(db.staffAdvanceDecision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'REJECT', remarks: 'Not eligible' }) });
    });

    it('re-checks affordability at approval time', async () => {
        salaryMock.getAdvanceSalarySummary.mockResolvedValue(salary({ currentInHand: 1000 }));
        await expect(reviewAdvance(reviewer(), review)).rejects.toThrow(/more than the expected in-hand salary/);
        expect(db.staffAdvance.updateMany).not.toHaveBeenCalled();
    });

    it('the applicant cannot approve their own advance, even as admin', async () => {
        await expect(reviewAdvance(actor({ userId: 'emp1', isAdmin: true }), review)).rejects.toMatchObject({ status: 403 });
    });

    it('a user without the stage role cannot review', async () => {
        await expect(reviewAdvance(actor({ userId: 'someone' }), review)).rejects.toMatchObject({ status: 403 });
    });

    it('an admin has no shortcut: without the stage role they cannot approve or reject', async () => {
        await expect(reviewAdvance(actor({ userId: 'boss', isAdmin: true }), review)).rejects.toMatchObject({ status: 403 });
        await expect(reviewAdvance(actor({ userId: 'boss', isAdmin: true }), { ...review, action: 'REJECT', remarks: 'No' })).rejects.toMatchObject({ status: 403 });
        expect(db.staffAdvance.updateMany).not.toHaveBeenCalled();
    });

    it('the stage role held for a different branch cannot review this branch\'s advance', async () => {
        const otherBranch = actor({ userId: 'boss', assignments: [{ roleId: 'role1', branchId: 'b9', pagePermissions: {} }] });
        await expect(reviewAdvance(otherBranch, review)).rejects.toMatchObject({ status: 403 });
    });

    it('a company-wide (null or Head Office) stage-role assignment can review any branch', async () => {
        const global = actor({ userId: 'boss', assignments: [{ roleId: 'role1', branchId: null, pagePermissions: {} }] });
        await expect(reviewAdvance(global, review)).resolves.toMatchObject({ status: 'APPROVED' });
    });

    it('an unauthorized caller gets 403 before any salary-based validation message', async () => {
        salaryMock.getAdvanceSalarySummary.mockResolvedValue(salary({ currentInHand: 1000 }));
        await expect(reviewAdvance(actor({ userId: 'someone' }), review)).rejects.toMatchObject({ status: 403 });
        expect(salaryMock.getAdvanceSalarySummary).not.toHaveBeenCalled();
    });

    it('a stale version is refused (409) and a lost update race is refused too', async () => {
        await expect(reviewAdvance(reviewer(), { ...review, expectedVersion: 5 })).rejects.toMatchObject({ status: 409 });
        db.staffAdvance.updateMany.mockResolvedValue({ count: 0 });
        await expect(reviewAdvance(reviewer(), review)).rejects.toMatchObject({ status: 409 });
    });

    it('an advance that is already approved cannot be reviewed again', async () => {
        db.staffAdvance.findUnique.mockImplementation(async ({ select }: any) => (select ? { employeeId: 'emp1', amount: '10000' } : advanceRecord({ status: 'ACTIVE', currentApprovalLevel: null })));
        await expect(reviewAdvance(reviewer(), review)).rejects.toMatchObject({ status: 403 });
    });
});

describe('editAdvance', () => {
    const edit = { expectedVersion: 1, amount: 12000, purpose: 'Medical', remarks: '', reason: '' };
    const reviewer = () => actor({ userId: 'boss', assignments: [{ roleId: 'role1', branchId: 'b1', pagePermissions: {} }] });

    beforeEach(() => {
        db.staffAdvance.findUnique.mockResolvedValue(advanceRecord());
        db.staffAdvance.findUniqueOrThrow.mockResolvedValue(advanceRecord());
        db.staffAdvance.updateMany.mockResolvedValue({ count: 1 });
    });

    it('is refused for an admin without the stage role, before any salary check', async () => {
        salaryMock.getAdvanceSalarySummary.mockResolvedValue(salary({ currentInHand: 1000 }));
        await expect(editAdvance(actor({ userId: 'boss', isAdmin: true }), 'adv1', edit)).rejects.toMatchObject({ status: 403 });
        expect(salaryMock.getAdvanceSalarySummary).not.toHaveBeenCalled();
        expect(db.staffAdvance.updateMany).not.toHaveBeenCalled();
    });

    it('lets the stage-role holder replace the document and records it in the history', async () => {
        const document = { fileKey: 'org/employee-emp1/staff-advance/new.pdf', fileName: 'new.pdf' };
        await editAdvance(reviewer(), 'adv1', { ...edit, amount: 10000, document });
        expect(db.staffAdvance.updateMany.mock.calls[0][0].data).toMatchObject({ documentKey: document.fileKey, documentName: 'new.pdf', documentMimeType: 'application/pdf' });
        expect(db.staffAdvanceDecision.create.mock.calls[0][0].data).toMatchObject({ action: 'EDIT', remarks: expect.stringContaining('Document replaced (new.pdf)') });
        expect(docStorage.isKeyFor).toHaveBeenCalledWith('emp1', document.fileKey, 'staff-advance');
    });

    it('refuses a replacement document from outside the applicant staff-advance folder', async () => {
        docStorage.isKeyFor.mockResolvedValue(false);
        await expect(editAdvance(reviewer(), 'adv1', { ...edit, document: { fileKey: 'org/employee-other/staff-advance/x.pdf', fileName: 'x.pdf' } })).rejects.toThrow(/document is invalid/);
        expect(db.staffAdvance.updateMany).not.toHaveBeenCalled();
    });
});

describe('advanceDocumentAccess', () => {
    it('returns a signed URL for an advance the actor may see, and 404 when there is no document', async () => {
        db.staffAdvance.findFirst.mockResolvedValue({ documentKey: 'k', documentName: 'slip.pdf', documentMimeType: 'application/pdf' });
        await expect(advanceDocumentAccess(actor(), 'adv1')).resolves.toMatchObject({ url: 'https://signed.example/doc', fileName: 'slip.pdf' });
        db.staffAdvance.findFirst.mockResolvedValue({ documentKey: null, documentName: null, documentMimeType: null });
        await expect(advanceDocumentAccess(actor(), 'adv1')).rejects.toMatchObject({ status: 404 });
        db.staffAdvance.findFirst.mockResolvedValue(null);
        await expect(advanceDocumentAccess(actor(), 'adv1')).rejects.toMatchObject({ status: 404 });
    });
});

describe('disburseAdvance', () => {
    const disburse = { id: 'adv1', expectedVersion: 2, disbursementDate: '2026-09-24', paymentMode: 'BANK_TRANSFER', reference: 'UTR123', remarks: null };
    const approved = (over: Record<string, unknown> = {}) => advanceRecord({ status: 'APPROVED', version: 2, currentApprovalLevel: null, approvedAt: new Date('2026-09-20T00:00:00Z'), ...over });
    const disburser = (over: Record<string, unknown> = {}) => actor({ userId: 'cashier', assignments: [{ roleId: 'disburser', branchId: null, pagePermissions: {} }], ...over });

    beforeEach(() => {
        db.staffAdvance.findUnique.mockResolvedValue(approved());
        db.staffAdvance.updateMany.mockResolvedValue({ count: 1 });
        db.user.findUnique.mockResolvedValue({ isActive: true, branchId: 'b1', branch: { isActive: true } });
        // The salary date is the one on the Staff Loan workflow.
        db.staffLoanWorkflowConfig.findFirst.mockResolvedValue({ salaryDay: 5 });
    });

    it('activates the advance, records the payment and creates exactly two interest-free installments on the salary date of the next two months', async () => {
        const result = await disburseAdvance(disburser(), disburse);
        expect(result).toEqual({ status: 'ACTIVE', advanceNumber: 'SA-000001' });
        expect(db.staffAdvance.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'adv1', version: 2, status: 'APPROVED' },
            data: expect.objectContaining({ status: 'ACTIVE', paymentMode: 'BANK_TRANSFER', paymentReference: 'UTR123', disbursedAt: new Date('2026-09-24') }),
        }));
        const rows = db.staffAdvanceSchedule.createMany.mock.calls[0][0].data;
        expect(rows.map((r: any) => r.installmentNo)).toEqual([1, 2]);
        expect(rows.reduce((sum: number, r: any) => sum + Number(r.amountDue), 0)).toBe(10000);
        expect(rows.map((r: any) => new Date(r.dueDate).toISOString().slice(0, 10))).toEqual(['2026-10-05', '2026-11-05']);
        expect(db.staffAdvanceDecision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'DISBURSE', actedById: 'cashier' }) });
    });

    it('creates a single installment of the whole amount, due next month, for a one-month advance', async () => {
        db.staffAdvance.findUnique.mockResolvedValue(approved({ repaymentMonths: 1 }));
        await disburseAdvance(disburser(), disburse);
        const rows = db.staffAdvanceSchedule.createMany.mock.calls[0][0].data;
        expect(rows.map((r: any) => r.installmentNo)).toEqual([1]);
        expect(Number(rows[0].amountDue)).toBe(10000);
        expect(new Date(rows[0].dueDate).toISOString().slice(0, 10)).toBe('2026-10-05');
    });

    it('needs a UTR for a bank transfer but not for cash', async () => {
        await expect(disburseAdvance(disburser(), { ...disburse, reference: null })).rejects.toThrow(/UTR/);
        await expect(disburseAdvance(disburser(), { ...disburse, paymentMode: 'CASH', reference: null })).resolves.toMatchObject({ status: 'ACTIVE' });
    });

    it('is allowed for an admin or a holder of a disbursement-authority role, nobody else', async () => {
        await expect(disburseAdvance(actor({ userId: 'boss', isAdmin: true }), disburse)).resolves.toBeTruthy();
        await expect(disburseAdvance(disburser(), disburse)).resolves.toBeTruthy();
        await expect(disburseAdvance(actor({ userId: 'someone' }), disburse)).rejects.toMatchObject({ status: 403 });
        // holding an approval-stage role is not a disbursement authority
        await expect(disburseAdvance(actor({ userId: 'reviewer', assignments: [{ roleId: 'role1', branchId: null, pagePermissions: {} }] }), disburse)).rejects.toMatchObject({ status: 403 });
    });

    it('the applicant cannot disburse their own advance, even as admin', async () => {
        await expect(disburseAdvance(actor({ userId: 'emp1', isAdmin: true }), disburse)).rejects.toMatchObject({ status: 403 });
    });

    it('only an APPROVED advance can be disbursed', async () => {
        for (const status of ['SUBMITTED', 'ACTIVE', 'COMPLETED', 'REJECTED']) {
            db.staffAdvance.findUnique.mockResolvedValue(approved({ status }));
            await expect(disburseAdvance(disburser(), disburse)).rejects.toMatchObject({ status: 400 });
        }
        expect(db.staffAdvanceSchedule.createMany).not.toHaveBeenCalled();
    });

    it('refuses a stale version and a lost update race, without creating a schedule', async () => {
        await expect(disburseAdvance(disburser(), { ...disburse, expectedVersion: 9 })).rejects.toMatchObject({ status: 409 });
        db.staffAdvance.updateMany.mockResolvedValue({ count: 0 });
        await expect(disburseAdvance(disburser(), disburse)).rejects.toMatchObject({ status: 409 });
    });

    it('refuses when the employee is no longer active', async () => {
        db.user.findUnique.mockResolvedValue({ isActive: false, branchId: 'b1', branch: { isActive: true } });
        await expect(disburseAdvance(disburser(), disburse)).rejects.toMatchObject({ status: 400 });
    });

    const dueDates = () => db.staffAdvanceSchedule.createMany.mock.calls[0][0].data.map((r: any) => new Date(r.dueDate).toISOString().slice(0, 10));

    it('uses the salary date of the STAFF LOAN workflow, the same as loans', async () => {
        await disburseAdvance(disburser(), disburse);
        expect(db.staffLoanWorkflowConfig.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { kind: 'LOAN' }, select: { salaryDay: true } }));
    });

    it('first due date "this month": the salary date of the disbursement month, then the next month', async () => {
        await disburseAdvance(disburser(), { ...disburse, disbursementDate: '2026-09-02', firstDueMonth: 'THIS_MONTH' });
        expect(dueDates()).toEqual(['2026-09-05', '2026-10-05']);
    });

    it('first due date "next month" (also the default) starts the month after disbursement', async () => {
        await disburseAdvance(disburser(), { ...disburse, firstDueMonth: 'NEXT_MONTH' });
        expect(dueDates()).toEqual(['2026-10-05', '2026-11-05']);
    });

    it('refuses "this month" once that month\'s salary date has passed, without writing anything', async () => {
        await expect(disburseAdvance(disburser(), { ...disburse, disbursementDate: '2026-09-24', firstDueMonth: 'THIS_MONTH' })).rejects.toThrow(/salary date for this month has already passed/);
        expect(db.staffAdvance.updateMany).not.toHaveBeenCalled();
        expect(db.staffAdvanceSchedule.createMany).not.toHaveBeenCalled();
    });

    it('a salary date that falls on a Sunday moves to the day before, and a short month uses its last day', async () => {
        db.staffLoanWorkflowConfig.findFirst.mockResolvedValue({ salaryDay: 25 }); // 25 Oct 2026 is a Sunday
        await disburseAdvance(disburser(), disburse);
        expect(dueDates()).toEqual(['2026-10-24', '2026-11-25']);
        db.staffAdvanceSchedule.createMany.mockClear();
        db.staffLoanWorkflowConfig.findFirst.mockResolvedValue({ salaryDay: 31 });
        await disburseAdvance(disburser(), { ...disburse, disbursementDate: '2026-01-10' });
        expect(dueDates()).toEqual(['2026-02-28', '2026-03-31']);
    });

    it('without a salary date the first due date is entered manually and the second is one month later', async () => {
        db.staffLoanWorkflowConfig.findFirst.mockResolvedValue({ salaryDay: null });
        await expect(disburseAdvance(disburser(), disburse)).rejects.toThrow(/Enter the first due date/);
        expect(db.staffAdvance.updateMany).not.toHaveBeenCalled();
        await disburseAdvance(disburser(), { ...disburse, firstDueDate: '2026-10-15' });
        expect(dueDates()).toEqual(['2026-10-15', '2026-11-15']);
    });
});
describe('cancelAdvance', () => {
    it('only the applicant can cancel, and only while it is under review', async () => {
        db.staffAdvance.updateMany.mockResolvedValue({ count: 1 });
        await cancelAdvance(actor(), { id: 'adv1', expectedVersion: 1 });
        expect(db.staffAdvance.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'adv1', employeeId: 'emp1', version: 1, status: 'SUBMITTED' } }));
        expect(db.staffAdvanceDecision.create).toHaveBeenCalledWith({ data: expect.objectContaining({ action: 'CANCEL' }) });

        db.staffAdvance.updateMany.mockResolvedValue({ count: 0 });
        await expect(cancelAdvance(actor(), { id: 'adv1', expectedVersion: 1 })).rejects.toMatchObject({ status: 409 });
    });
});
