import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import type { StaffLoanActor } from './application-access';

const db = vi.hoisted(() => {
    const tx = {
        user: { findUnique: vi.fn(), findMany: vi.fn(), count: vi.fn() },
        role: { findUnique: vi.fn(), findMany: vi.fn() },
        staffLoanScheme: { findUnique: vi.fn(), findMany: vi.fn() },
        staffLoanWorkflowConfig: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
        $queryRaw: vi.fn(),
        staffLoan: {
            groupBy: vi.fn(),
            findFirst: vi.fn(),
            findMany: vi.fn(),
            findUnique: vi.fn(),
            findUniqueOrThrow: vi.fn(),
            count: vi.fn(),
            create: vi.fn(),
            updateMany: vi.fn(),
        },
        staffLoanDecision: { create: vi.fn() },
        staffLoanSchedule: { createMany: vi.fn(), update: vi.fn() },
        staffLoanTransaction: { create: vi.fn() },
        staffLoanRepaymentAllocation: { create: vi.fn(), createMany: vi.fn() },
        employeeSalaryMaster: { findMany: vi.fn() },
        userRoleAssignment: { count: vi.fn() },
    };
    return {
        tx,
        prisma: {
            $transaction: vi.fn(),
            user: tx.user,
            role: tx.role,
            staffLoanScheme: tx.staffLoanScheme,
            staffLoanWorkflowConfig: tx.staffLoanWorkflowConfig,
            staffLoan: tx.staffLoan,
            staffLoanDecision: tx.staffLoanDecision,
            staffLoanSchedule: tx.staffLoanSchedule,
            staffLoanTransaction: tx.staffLoanTransaction,
            staffLoanRepaymentAllocation: tx.staffLoanRepaymentAllocation,
            employeeSalaryMaster: tx.employeeSalaryMaster,
            userRoleAssignment: tx.userRoleAssignment,
        },
    };
});

vi.mock('@/app/lib/db', () => ({ prisma: db.prisma }));

const docStorage = vi.hoisted(() => ({
    isKeyFor: vi.fn(),
    read: vi.fn(),
}));
vi.mock('@/app/lib/storage/staff-loan-document-storage', () => ({
    isStaffLoanDocumentKeyFor: docStorage.isKeyFor,
    readStaffLoanDocument: docStorage.read,
}));
vi.mock('@/app/lib/storage/gcs-client', () => ({ getSignedReadUrl: vi.fn(async () => 'https://signed.example/doc') }));

import {
    applicationDetail,
    applicationOptions,
    cancelApplication,
    disburseLoan,
    documentUploadTargetForReviewer,
    editApplicationTerms,
    getLoanRepaymentDetails,
    listActiveLoansForRepayment,
    listApplications,
    recordEarlySettlement,
    recordRepayment,
    reviewApplication,
    saveApplication,
} from './application-service';

const actor: StaffLoanActor = {
    userId: 'emp-1',
    isAdmin: false,
    branchIds: ['branch-1'],
    assignments: [
        { roleId: 'fdo-role', branchId: 'branch-1', pagePermissions: null },
    ],
};

const reviewerActor: StaffLoanActor = {
    userId: 'approver-1',
    isAdmin: false,
    branchIds: ['branch-1'],
    assignments: [
        { roleId: 'bm-role', branchId: 'branch-1', pagePermissions: null },
    ],
};

const mockEmployee = {
    id: 'emp-1',
    employeeId: 'EMP001',
    firstName: 'Arun',
    lastName: 'Kumar',
    isActive: true,
    dateOfJoining: new Date('2024-01-01'),
    branchId: 'branch-1',
    departmentId: 'dept-1',
    branch: { name: 'Karur Branch', isActive: true },
};

const mockScheme = {
    id: 'scheme-1',
    code: 'GEN-01',
    name: 'General Staff Loan',
    description: 'Standard staff loan',
    minimumServiceMonths: 6,
    minimumSalaryPerMonth: new Prisma.Decimal(0),
    amountBasis: 'FIXED_AMOUNT' as const,
    maximumAmount: new Prisma.Decimal(50000),
    salaryMultiplier: null,
    maximumTenureMonths: 24,
    maximumActiveLoans: 1,
    interestType: 'FLAT' as const,
    annualInterestRate: new Prisma.Decimal(6),
    isActive: true,
    version: 1,
    applicableBranches: [],
    applicableDepartments: [],
    applicableRoles: [],
    salaryBasisComponents: [],
};

const mockWorkflow = {
    id: 'wf-1',
    name: 'Staff Loan Flow',
    isActive: true,
    stages: [
        { id: 'stage-1', levelOrder: 1, stageName: 'Branch Manager Review', roleId: 'bm-role', role: { id: 'bm-role', name: 'Branch Manager', isActive: true } },
    ],
    disbursementRoles: [
        { id: 'cashier-role', name: 'Cashier', isActive: true },
    ],
};

beforeEach(() => {
    vi.resetAllMocks();
    db.prisma.$transaction.mockImplementation(async (arg: unknown) => {
        if (typeof arg === 'function') {
            return (arg as (tx: typeof db.tx) => unknown)(db.tx);
        }
        if (Array.isArray(arg)) {
            return Promise.all(arg);
        }
        return arg;
    });
    db.tx.$queryRaw.mockResolvedValue([{ n: BigInt(1) }]);
    // Every scope calculation reads the workflow configs (an admin no longer skips it), so default to none.
    db.tx.staffLoanWorkflowConfig.findMany.mockResolvedValue([]);
    docStorage.isKeyFor.mockResolvedValue(true);
    docStorage.read.mockResolvedValue({ buffer: Buffer.from('doc-bytes'), contentType: 'image/jpeg' });
});

describe('applicationOptions', () => {
    it('returns options with eligibility evaluated for the logged in employee', async () => {
        db.tx.user.findUnique.mockResolvedValue(mockEmployee);
        db.tx.staffLoanScheme.findMany.mockResolvedValue([mockScheme]);
        db.tx.staffLoanWorkflowConfig.findFirst.mockResolvedValue(mockWorkflow);
        db.tx.staffLoan.count.mockResolvedValue(0);

        const options = await applicationOptions(actor);

        expect(options.employee.name).toBe('Arun Kumar');
        expect(options.employee.branchName).toBe('Karur Branch');
        expect(options.workflowAvailable).toBe(true);
        expect(options.schemes).toHaveLength(1);
        expect(options.schemes[0].eligibilityError).toBeNull();
        expect(options.schemes[0].maximumAmount).toBe(50000);
    });

    it('flags service period requirement when employee joined recently', async () => {
        db.tx.user.findUnique.mockResolvedValue({
            ...mockEmployee,
            dateOfJoining: new Date(), // Just joined today
        });
        db.tx.staffLoanScheme.findMany.mockResolvedValue([mockScheme]);
        db.tx.staffLoanWorkflowConfig.findFirst.mockResolvedValue(mockWorkflow);
        db.tx.staffLoan.count.mockResolvedValue(0);

        const options = await applicationOptions(actor);
        expect(options.schemes[0].eligibilityError).toContain('requires 6 completed months of service');
    });

    it('flags minimum monthly salary requirement when employee salary is below the scheme threshold', async () => {
        const salaryGatedScheme = { ...mockScheme, minimumSalaryPerMonth: new Prisma.Decimal(20000) };
        db.tx.user.findUnique.mockResolvedValue(mockEmployee);
        db.tx.staffLoanScheme.findMany.mockResolvedValue([salaryGatedScheme]);
        db.tx.staffLoanWorkflowConfig.findFirst.mockResolvedValue(mockWorkflow);
        db.tx.staffLoan.count.mockResolvedValue(0);
        db.tx.employeeSalaryMaster.findMany.mockResolvedValue([
            { salaryComponentId: 'basic-sal', amount: new Prisma.Decimal(15000) },
        ]);

        const options = await applicationOptions(actor);
        expect(options.schemes[0].eligibilityError).toContain('minimum monthly salary of');
    });

    it('calculates maximumAmount dynamically for SALARY_MULTIPLE schemes', async () => {
        const salaryScheme = {
            ...mockScheme,
            amountBasis: 'SALARY_MULTIPLE' as const,
            maximumAmount: null,
            salaryMultiplier: new Prisma.Decimal(3),
            salaryBasisComponents: [{ id: 'basic-sal', isActive: true, type: 'EARNINGS' }],
        };
        db.tx.user.findUnique.mockResolvedValue(mockEmployee);
        db.tx.staffLoanScheme.findMany.mockResolvedValue([salaryScheme]);
        db.tx.staffLoanWorkflowConfig.findFirst.mockResolvedValue(mockWorkflow);
        db.tx.staffLoan.count.mockResolvedValue(0);
        db.tx.employeeSalaryMaster.findMany.mockResolvedValue([
            { salaryComponentId: 'basic-sal', amount: new Prisma.Decimal(25000) },
        ]);

        const options = await applicationOptions(actor);
        expect(options.schemes[0].eligibilityError).toBeNull();
        expect(options.schemes[0].maximumAmount).toBe(75000); // 25000 * 3
    });

    it('flags when active loan limit is reached', async () => {
        db.tx.user.findUnique.mockResolvedValue(mockEmployee);
        db.tx.staffLoanScheme.findMany.mockResolvedValue([mockScheme]);
        db.tx.staffLoanWorkflowConfig.findFirst.mockResolvedValue(mockWorkflow);
        db.tx.staffLoan.count.mockResolvedValue(1); // Already has 1 active loan

        const options = await applicationOptions(actor);
        expect(options.schemes[0].eligibilityError).toContain('active-loan limit has been reached');
    });

    it('provides employee list and canSelectEmployee: true for admin actor', async () => {
        const adminActor: StaffLoanActor = {
            userId: 'admin-1',
            isAdmin: true,
            branchIds: null,
            assignments: [],
        };
        db.tx.user.findUnique.mockResolvedValue(mockEmployee);
        db.tx.user.findMany.mockResolvedValue([
            { id: 'emp-1', firstName: 'Arun', lastName: 'Kumar', employeeId: 'EMP001', role: 'LOAN_OFFICER', branch: { name: 'Karur Branch' } },
            { id: 'emp-2', firstName: 'Priya', lastName: 'Sharma', employeeId: 'EMP002', role: 'BRANCH_MANAGER', branch: { name: 'Trichy Branch' } },
        ]);
        db.tx.staffLoanScheme.findMany.mockResolvedValue([mockScheme]);
        db.tx.staffLoanWorkflowConfig.findFirst.mockResolvedValue(mockWorkflow);
        db.tx.staffLoan.count.mockResolvedValue(0);

        const options = await applicationOptions(adminActor);
        expect(options.canSelectEmployee).toBe(true);
        expect(options.employees).toHaveLength(2);
        expect(options.employees?.[0].name).toBe('Arun Kumar');
    });

    it('evaluates target employee when targetEmployeeId is provided by authorized actor', async () => {
        const adminActor: StaffLoanActor = {
            userId: 'admin-1',
            isAdmin: true,
            branchIds: null,
            assignments: [],
        };
        const otherEmployee = {
            ...mockEmployee,
            id: 'emp-2',
            firstName: 'Priya',
            lastName: 'Sharma',
            employeeId: 'EMP002',
        };
        db.tx.user.findUnique.mockResolvedValue(otherEmployee);
        db.tx.user.findMany.mockResolvedValue([]);
        db.tx.staffLoanScheme.findMany.mockResolvedValue([mockScheme]);
        db.tx.staffLoanWorkflowConfig.findFirst.mockResolvedValue(mockWorkflow);
        db.tx.staffLoan.count.mockResolvedValue(0);

        const options = await applicationOptions(adminActor, 'emp-2');
        expect(options.employee.id).toBe('emp-2');
        expect(options.employee.name).toBe('Priya Sharma');
    });
});

describe('saveApplication', () => {
    const input = {
        schemeId: 'scheme-1',
        requestedAmount: 30000,
        tenureMonths: 12,
        recoveryMethod: 'SALARY' as const,
        purpose: 'House repair',
        remarks: 'Urgent',
        document: { fileKey: 'org/employee-emp-1/staff-loan/slip.jpg', fileName: 'salary-slip.jpg' },
    };

    it('rejects a document that is not inside the applicant staff-loan folder', async () => {
        docStorage.isKeyFor.mockResolvedValue(false);
        await expect(saveApplication(actor, input, false)).rejects.toThrow('attached document is invalid');
        expect(db.tx.staffLoan.create).not.toHaveBeenCalled();
    });

    it('rejects a document that is missing from storage or has a disallowed type', async () => {
        docStorage.read.mockResolvedValue(null);
        await expect(saveApplication(actor, input, false)).rejects.toThrow('missing or is not an allowed file');
        docStorage.read.mockResolvedValue({ buffer: Buffer.from('x'), contentType: 'text/html' });
        await expect(saveApplication(actor, input, false)).rejects.toThrow('missing or is not an allowed file');
    });

    it('stores the verified document details on the loan', async () => {
        db.tx.user.findUnique.mockResolvedValue(mockEmployee);
        db.tx.staffLoanScheme.findUnique.mockResolvedValue(mockScheme);
        db.tx.staffLoan.count.mockResolvedValue(0);
        db.tx.staffLoan.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
            id: 'loan-doc', loanNumber: 'SL-DOC', employeeId: actor.userId, branchId: 'branch-1', schemeId: 'scheme-1',
            status: 'DRAFT', requestedAmount: new Prisma.Decimal(30000), approvedAmount: null, tenureMonths: 12,
            interestType: 'FLAT', annualInterestRate: new Prisma.Decimal(6), recoveryMethod: 'SALARY',
            purpose: 'House repair', remarks: 'Urgent', version: 1, currentApprovalLevel: null, createdAt: new Date(),
            schemeSnapshot: { name: 'General Staff Loan' }, employee: mockEmployee, branch: { name: 'Karur Branch' }, workflowConfig: null,
            documentKey: data.documentKey, documentName: data.documentName, documentMimeType: data.documentMimeType, documentSize: data.documentSize,
        }));

        const res = await saveApplication(actor, input, false);
        expect(db.tx.staffLoan.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                documentKey: 'org/employee-emp-1/staff-loan/slip.jpg', documentName: 'salary-slip.jpg',
                documentMimeType: 'image/jpeg', documentSize: 'doc-bytes'.length,
            }),
        }));
        expect(res.document).toEqual({ fileKey: 'org/employee-emp-1/staff-loan/slip.jpg', fileName: 'salary-slip.jpg', mimeType: 'image/jpeg', fileSize: 9 });
    });

    it('saves a draft application successfully', async () => {
        db.tx.user.findUnique.mockResolvedValue(mockEmployee);
        db.tx.staffLoanScheme.findUnique.mockResolvedValue(mockScheme);
        db.tx.staffLoan.count.mockResolvedValue(0);
        db.tx.staffLoan.create.mockResolvedValue({
            id: 'loan-1',
            loanNumber: 'SL-123456',
            employeeId: actor.userId,
            branchId: 'branch-1',
            schemeId: 'scheme-1',
            status: 'DRAFT',
            requestedAmount: new Prisma.Decimal(30000),
            approvedAmount: null,
            tenureMonths: 12,
            interestType: 'FLAT',
            annualInterestRate: new Prisma.Decimal(6),
            recoveryMethod: 'SALARY',
            purpose: 'House repair',
            remarks: 'Urgent',
            version: 1,
            currentApprovalLevel: null,
            createdAt: new Date(),
            schemeSnapshot: { name: 'General Staff Loan' },
            employee: mockEmployee,
            branch: { name: 'Karur Branch' },
            workflowConfig: null,
        });

        const res = await saveApplication(actor, input, false);
        expect(res.status).toBe('DRAFT');
        expect(res.requestedAmount).toBe(30000);
        expect(db.tx.staffLoan.create).toHaveBeenCalledOnce();
    });

    it('submits an application, validates workflow reviewers, and creates SUBMIT decision', async () => {
        db.tx.user.findUnique.mockResolvedValue(mockEmployee);
        db.tx.staffLoanScheme.findUnique.mockResolvedValue(mockScheme);
        db.tx.staffLoan.count.mockResolvedValue(0);
        db.tx.staffLoanWorkflowConfig.findFirst.mockResolvedValue(mockWorkflow);
        db.tx.userRoleAssignment.count.mockResolvedValue(1); // Eligible reviewer exists
        db.tx.staffLoan.create.mockResolvedValue({
            id: 'loan-1',
            loanNumber: 'SL-123456',
            employeeId: actor.userId,
            branchId: 'branch-1',
            schemeId: 'scheme-1',
            status: 'SUBMITTED',
            requestedAmount: new Prisma.Decimal(30000),
            approvedAmount: null,
            tenureMonths: 12,
            interestType: 'FLAT',
            annualInterestRate: new Prisma.Decimal(6),
            recoveryMethod: 'SALARY',
            purpose: 'House repair',
            remarks: 'Urgent',
            version: 1,
            currentApprovalLevel: 1,
            createdAt: new Date(),
            schemeSnapshot: { name: 'General Staff Loan' },
            employee: mockEmployee,
            branch: { name: 'Karur Branch' },
            workflowConfig: mockWorkflow,
        });

        const res = await saveApplication(actor, input, true);
        expect(res.status).toBe('SUBMITTED');
        expect(db.tx.staffLoanDecision.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ loanId: 'loan-1', action: 'SUBMIT' }),
            })
        );
    });

    it('rejects save when requested amount exceeds scheme limit', async () => {
        db.tx.user.findUnique.mockResolvedValue(mockEmployee);
        db.tx.staffLoanScheme.findUnique.mockResolvedValue(mockScheme);
        db.tx.staffLoan.count.mockResolvedValue(0);

        await expect(saveApplication(actor, { ...input, requestedAmount: 90000 }, false))
            .rejects.toThrow('exceeds the scheme limit');
    });

    it('rejects stale update on version mismatch', async () => {
        db.tx.staffLoan.findFirst.mockResolvedValue({
            id: 'loan-1',
            employeeId: actor.userId,
            version: 2, // Database has version 2
            status: 'DRAFT',
            branchId: 'branch-1',
        });

        await expect(saveApplication(actor, input, false, { id: 'loan-1', expectedVersion: 1 }))
            .rejects.toMatchObject({ status: 409 });
    });

    it('allows admin to apply on behalf of another employee', async () => {
        const adminActor: StaffLoanActor = {
            userId: 'admin-1',
            isAdmin: true,
            branchIds: null,
            assignments: [],
        };
        const otherEmployee = {
            ...mockEmployee,
            id: 'emp-2',
            firstName: 'Priya',
            lastName: 'Sharma',
        };
        db.tx.user.findUnique.mockResolvedValue(otherEmployee);
        db.tx.staffLoanScheme.findUnique.mockResolvedValue(mockScheme);
        db.tx.staffLoan.count.mockResolvedValue(0);
        db.tx.staffLoan.create.mockResolvedValue({
            id: 'loan-2',
            loanNumber: 'SL-654321',
            employeeId: 'emp-2',
            branchId: 'branch-1',
            schemeId: 'scheme-1',
            status: 'DRAFT',
            requestedAmount: new Prisma.Decimal(30000),
            approvedAmount: null,
            tenureMonths: 12,
            interestType: 'FLAT',
            annualInterestRate: new Prisma.Decimal(6),
            recoveryMethod: 'SALARY',
            purpose: 'House repair',
            remarks: 'Urgent',
            version: 1,
            currentApprovalLevel: null,
            createdAt: new Date(),
            schemeSnapshot: { name: 'General Staff Loan' },
            employee: otherEmployee,
            branch: { name: 'Karur Branch' },
            workflowConfig: null,
        });

        const res = await saveApplication(adminActor, { ...input, employeeId: 'emp-2' }, false);
        expect(res.employeeId).toBe('emp-2');
        expect(res.employeeName).toBe('Priya Sharma');
    });

    it('rejects save when non-admin/non-HR actor attempts to apply on behalf of another employee', async () => {
        db.tx.user.findUnique.mockResolvedValue(mockEmployee);
        db.tx.staffLoanScheme.findUnique.mockResolvedValue(mockScheme);

        await expect(saveApplication(actor, { ...input, employeeId: 'emp-2' }, false))
            .rejects.toThrow('You are only authorized to apply for your own staff loan.');
    });

    it('validates reviewer via direct user.role when userRoleAssignment is absent', async () => {
        db.tx.user.findUnique.mockResolvedValue(mockEmployee);
        db.tx.staffLoanScheme.findUnique.mockResolvedValue(mockScheme);
        db.tx.staffLoan.count.mockResolvedValue(0);
        db.tx.staffLoanWorkflowConfig.findFirst.mockResolvedValue(mockWorkflow);
        db.tx.role.findUnique.mockResolvedValue({ id: 'bm-role', slug: 'branch-manager', legacyRole: 'BRANCH_MANAGER' });
        db.tx.userRoleAssignment.count.mockResolvedValue(0); // No explicit RBAC
        db.tx.user.count.mockResolvedValue(1); // Direct BM user exists
        db.tx.staffLoan.create.mockResolvedValue({
            id: 'loan-1',
            loanNumber: 'SL-123456',
            employeeId: actor.userId,
            branchId: 'branch-1',
            schemeId: 'scheme-1',
            status: 'SUBMITTED',
            requestedAmount: new Prisma.Decimal(30000),
            approvedAmount: null,
            tenureMonths: 12,
            interestType: 'FLAT',
            annualInterestRate: new Prisma.Decimal(6),
            recoveryMethod: 'SALARY',
            purpose: 'House repair',
            remarks: 'Urgent',
            version: 1,
            currentApprovalLevel: 1,
            createdAt: new Date(),
            schemeSnapshot: { name: 'General Staff Loan' },
            employee: mockEmployee,
            branch: { name: 'Karur Branch' },
            workflowConfig: mockWorkflow,
        });

        const res = await saveApplication(actor, input, true);
        expect(res.status).toBe('SUBMITTED');
        expect(res.currentStage).toBe('Branch Manager Review');
    });
});

describe('reviewApplication', () => {
    const loanToReview = {
        id: 'loan-1',
        version: 1,
        employeeId: 'emp-1', // Borrower is emp-1
        branchId: 'branch-1',
        status: 'SUBMITTED',
        currentApprovalLevel: 1,
        requestedAmount: new Prisma.Decimal(30000),
        workflowConfig: mockWorkflow,
    };

    it('prevents borrower self-approval', async () => {
        // Logged-in actor is emp-1 (the borrower)
        db.tx.staffLoan.findUnique.mockResolvedValue(loanToReview);

        await expect(reviewApplication(actor, { id: 'loan-1', expectedVersion: 1, action: 'APPROVE', remarks: '' }))
            .rejects.toMatchObject({ status: 403 });
    });

    it('prevents review if reviewer lacks assignment for stage role', async () => {
        const unauthorizedActor: StaffLoanActor = {
            userId: 'other-user',
            isAdmin: false,
            branchIds: ['branch-1'],
            assignments: [{ roleId: 'wrong-role', branchId: 'branch-1', pagePermissions: null }],
        };
        db.tx.staffLoan.findUnique.mockResolvedValue(loanToReview);

        await expect(reviewApplication(unauthorizedActor, { id: 'loan-1', expectedVersion: 1, action: 'APPROVE', remarks: '' }))
            .rejects.toMatchObject({ status: 403 });
    });

    it('gives an admin no shortcut: without the stage role they cannot approve or reject', async () => {
        db.tx.staffLoan.findUnique.mockResolvedValue(loanToReview);
        const admin: StaffLoanActor = { userId: 'admin-1', isAdmin: true, branchIds: null, assignments: [] };
        await expect(reviewApplication(admin, { id: 'loan-1', expectedVersion: 1, action: 'APPROVE', remarks: '' })).rejects.toMatchObject({ status: 403 });
        await expect(reviewApplication(admin, { id: 'loan-1', expectedVersion: 1, action: 'REJECT', remarks: 'No' })).rejects.toMatchObject({ status: 403 });
        expect(db.tx.staffLoan.updateMany).not.toHaveBeenCalled();
    });

    it('refuses the stage role when it is held for a different branch', async () => {
        db.tx.staffLoan.findUnique.mockResolvedValue(loanToReview);
        const otherBranch: StaffLoanActor = { userId: 'approver-2', isAdmin: false, branchIds: ['branch-1', 'branch-9'], assignments: [{ roleId: 'bm-role', branchId: 'branch-9', pagePermissions: null }] };
        await expect(reviewApplication(otherBranch, { id: 'loan-1', expectedVersion: 1, action: 'APPROVE', remarks: '' })).rejects.toMatchObject({ status: 403 });
    });

    it('lets a company-wide (null or Head Office) stage-role assignment review any branch', async () => {
        db.tx.staffLoan.findUnique.mockResolvedValue(loanToReview);
        db.tx.staffLoan.updateMany.mockResolvedValue({ count: 1 });
        const headOffice: StaffLoanActor = { userId: 'ho-1', isAdmin: false, branchIds: null, assignments: [{ roleId: 'bm-role', branchId: null, pagePermissions: null }] };
        await expect(reviewApplication(headOffice, { id: 'loan-1', expectedVersion: 1, action: 'APPROVE', remarks: '' })).resolves.toMatchObject({ status: 'APPROVED' });
    });

    it('never offers review from the register tab, even to the stage-role holder', async () => {
        db.tx.staffLoan.findMany.mockResolvedValue([{
            ...loanToReview, employee: mockEmployee, branch: { name: 'Karur Branch' }, workflowConfig: mockWorkflow,
            schemeSnapshot: { name: 'General Staff Loan' }, createdAt: new Date(),
        }]);
        db.tx.staffLoan.count.mockResolvedValue(1);
        db.tx.staffLoan.groupBy.mockResolvedValue([]);
        const viewer: StaffLoanActor = { ...reviewerActor, assignments: [...reviewerActor.assignments, { roleId: 'hr-role', branchId: null, pagePermissions: { '/dashboard/hr/staff-loans/management': { view: true } } }] };
        const register = await listApplications(viewer, 'register', 1);
        expect(register.items.every(i => i.canReview === false)).toBe(true);
    });

    it('approves and marks final APPROVED when no further stages exist', async () => {
        db.tx.staffLoan.findUnique.mockResolvedValue(loanToReview);
        db.tx.staffLoan.updateMany.mockResolvedValue({ count: 1 });

        const result = await reviewApplication(reviewerActor, { id: 'loan-1', expectedVersion: 1, action: 'APPROVE', remarks: 'Looks good' });
        expect(result.status).toBe('APPROVED');
        expect(db.tx.staffLoan.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ status: 'APPROVED', approvedAmount: loanToReview.requestedAmount }),
            })
        );
        expect(db.tx.staffLoanDecision.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ action: 'APPROVE', stageName: 'Branch Manager Review' }),
            })
        );
    });

    it('advances to next stage if additional stages exist', async () => {
        const multiStageWorkflow = {
            ...mockWorkflow,
            stages: [
                { id: 'stage-1', levelOrder: 1, stageName: 'BM Review', roleId: 'bm-role', role: { id: 'bm-role', name: 'BM', isActive: true } },
                { id: 'stage-2', levelOrder: 2, stageName: 'HR Review', roleId: 'hr-role', role: { id: 'hr-role', name: 'HR', isActive: true } },
            ],
        };
        db.tx.staffLoan.findUnique.mockResolvedValue({
            ...loanToReview,
            workflowConfig: multiStageWorkflow,
        });
        db.tx.staffLoan.updateMany.mockResolvedValue({ count: 1 });

        const result = await reviewApplication(reviewerActor, { id: 'loan-1', expectedVersion: 1, action: 'APPROVE', remarks: '' });
        expect(result.status).toBe('SUBMITTED'); // Still pending next stage
        expect(db.tx.staffLoan.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ status: 'SUBMITTED', currentApprovalLevel: 2 }),
            })
        );
    });

    it('rejects with a reason and marks the loan REJECTED', async () => {
        db.tx.staffLoan.findUnique.mockResolvedValue(loanToReview);
        db.tx.staffLoan.updateMany.mockResolvedValue({ count: 1 });

        const result = await reviewApplication(reviewerActor, { id: 'loan-1', expectedVersion: 1, action: 'REJECT', remarks: 'Not eligible' });
        expect(result.status).toBe('REJECTED');
        expect(db.tx.staffLoan.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ status: 'REJECTED' }) })
        );
    });
});

describe('editApplicationTerms', () => {
    const editableLoan = {
        id: 'loan-1', loanNumber: 'SL-000001', version: 1, employeeId: 'emp-1', branchId: 'branch-1', schemeId: 'scheme-1',
        status: 'SUBMITTED', currentApprovalLevel: 1,
        requestedAmount: new Prisma.Decimal(30000), approvedAmount: null, tenureMonths: 12,
        interestType: 'FLAT' as const, annualInterestRate: new Prisma.Decimal(6), recoveryMethod: 'SALARY',
        purpose: 'House repair', remarks: 'Urgent', createdAt: new Date(),
        schemeSnapshot: { name: 'General Staff Loan' }, employee: mockEmployee, branch: { name: 'Karur Branch' },
        workflowConfig: mockWorkflow,
    };
    const edit = {
        expectedVersion: 1, schemeId: 'scheme-1', requestedAmount: 20000, tenureMonths: 10,
        interestType: 'FLAT' as const, annualInterestRate: 5, recoveryMethod: 'SALARY' as const,
        purpose: 'House repair', remarks: 'Urgent', reason: 'Reduced per policy',
    };
    const otherScheme = { ...mockScheme, id: 'scheme-2', code: 'EMG-02', name: 'Emergency Loan', version: 4, maximumAmount: new Prisma.Decimal(10000), maximumTenureMonths: 6, interestType: 'MONTHLY' as const, annualInterestRate: new Prisma.Decimal(1) };

    beforeEach(() => {
        db.tx.staffLoan.findUnique.mockResolvedValue(editableLoan);
        db.tx.staffLoanScheme.findUnique.mockResolvedValue(mockScheme);
        db.tx.user.findUnique.mockResolvedValue(mockEmployee);
        db.tx.staffLoan.count.mockResolvedValue(0);
        db.tx.staffLoan.updateMany.mockResolvedValue({ count: 1 });
        db.tx.staffLoan.findUniqueOrThrow.mockResolvedValue({ ...editableLoan, requestedAmount: new Prisma.Decimal(20000), tenureMonths: 10, annualInterestRate: new Prisma.Decimal(5), version: 2 });
    });

    it('lets the current-stage reviewer change the terms and records the edit in the audit trail', async () => {
        const res = await editApplicationTerms(reviewerActor, 'loan-1', edit);
        expect(db.tx.staffLoan.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ id: 'loan-1', version: 1, status: 'SUBMITTED' }),
            data: expect.objectContaining({ tenureMonths: 10, version: { increment: 1 } }),
        }));
        expect(db.tx.staffLoanDecision.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ loanId: 'loan-1', action: 'EDIT', actedById: reviewerActor.userId, stageName: 'Branch Manager Review' }),
        }));
        const remarks = db.tx.staffLoanDecision.create.mock.calls[0][0].data.remarks as string;
        expect(remarks).toContain('Amount');
        expect(remarks).toContain('Tenure 12 → 10 months');
        expect(remarks).toContain('Reduced per policy');
        // Dependent amounts are recalculated from the edited terms: 20000 @ 5% p.a. flat for 10 months
        expect(res.requestedAmount).toBe(20000);
        expect(res.interestAmount).toBe(833.33);
        expect(res.totalPayable).toBe(20833.33);
    });

    it('does not let the borrower or an unassigned user edit', async () => {
        await expect(editApplicationTerms(actor, 'loan-1', edit)).rejects.toMatchObject({ status: 403 });
        const stranger: StaffLoanActor = { userId: 'other', isAdmin: false, branchIds: ['branch-1'], assignments: [{ roleId: 'wrong-role', branchId: 'branch-1', pagePermissions: null }] };
        await expect(editApplicationTerms(stranger, 'loan-1', edit)).rejects.toMatchObject({ status: 403 });
        expect(db.tx.staffLoan.updateMany).not.toHaveBeenCalled();
    });

    it('refuses to edit once the loan is no longer under review or the version moved on', async () => {
        db.tx.staffLoan.findUnique.mockResolvedValue({ ...editableLoan, status: 'APPROVED', currentApprovalLevel: null });
        await expect(editApplicationTerms(reviewerActor, 'loan-1', edit)).rejects.toMatchObject({ status: 403 });
        db.tx.staffLoan.findUnique.mockResolvedValue({ ...editableLoan, version: 5 });
        await expect(editApplicationTerms(reviewerActor, 'loan-1', edit)).rejects.toMatchObject({ status: 409 });
        db.tx.staffLoan.updateMany.mockResolvedValue({ count: 0 });
        db.tx.staffLoan.findUnique.mockResolvedValue(editableLoan);
        await expect(editApplicationTerms(reviewerActor, 'loan-1', edit)).rejects.toMatchObject({ status: 409 });
    });

    it('enforces scheme limits, interest rules and requires an actual change', async () => {
        await expect(editApplicationTerms(reviewerActor, 'loan-1', { ...edit, requestedAmount: 60000 })).rejects.toThrow('exceeds the scheme limit');
        await expect(editApplicationTerms(reviewerActor, 'loan-1', { ...edit, tenureMonths: 36 })).rejects.toThrow('exceeds the scheme limit');
        await expect(editApplicationTerms(reviewerActor, 'loan-1', { ...edit, annualInterestRate: 0 })).rejects.toThrow('positive interest rate');
        await expect(editApplicationTerms(reviewerActor, 'loan-1', { ...edit, interestType: 'INTEREST_FREE', annualInterestRate: 3 })).rejects.toThrow('interest-free');
        await expect(editApplicationTerms(reviewerActor, 'loan-1', {
            ...edit, requestedAmount: 30000, tenureMonths: 12, annualInterestRate: 6, reason: '',
        })).rejects.toThrow('No changes');
    });

    it('edits every detail together: interest type, recovery mode, purpose and applicant remarks', async () => {
        await editApplicationTerms(reviewerActor, 'loan-1', {
            ...edit, interestType: 'MONTHLY', annualInterestRate: 1, recoveryMethod: 'CASH_BANK', purpose: 'Medical', remarks: 'Doctor letter attached',
        });
        expect(db.tx.staffLoan.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                interestType: 'MONTHLY', recoveryMethod: 'CASH_BANK', purpose: 'Medical', remarks: 'Doctor letter attached',
                requestedAmount: new Prisma.Decimal(20000), tenureMonths: 10,
            }),
        }));
        const audit = db.tx.staffLoanDecision.create.mock.calls[0][0].data.remarks as string;
        expect(audit).toContain('Interest type Flat → Monthly');
        expect(audit).toContain('Recovery Salary deduction → Cash / Bank');
        expect(audit).toContain('Purpose updated');
        expect(audit).toContain('Applicant remarks updated');
        // scheme unchanged: snapshot/version untouched
        expect(db.tx.staffLoan.updateMany.mock.calls[0][0].data).not.toHaveProperty('schemeSnapshot');
    });

    it('moves the loan to another eligible scheme and refreshes the scheme snapshot', async () => {
        db.tx.staffLoanScheme.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => where.id === 'scheme-2' ? otherScheme : mockScheme);
        await editApplicationTerms(reviewerActor, 'loan-1', { ...edit, schemeId: 'scheme-2', requestedAmount: 8000, tenureMonths: 5, interestType: 'MONTHLY', annualInterestRate: 1 });
        expect(db.tx.staffLoan.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                schemeId: 'scheme-2', schemeVersion: 4,
                schemeSnapshot: expect.objectContaining({ code: 'EMG-02', name: 'Emergency Loan' }),
                eligibilitySnapshot: expect.objectContaining({ error: null }),
            }),
        }));
        expect((db.tx.staffLoanDecision.create.mock.calls[0][0].data.remarks as string)).toContain('Scheme General Staff Loan → Emergency Loan');
    });

    it('validates the new scheme: must be active, within its limits, and the employee must be eligible', async () => {
        db.tx.staffLoanScheme.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => where.id === 'scheme-2' ? { ...otherScheme, isActive: false } : mockScheme);
        await expect(editApplicationTerms(reviewerActor, 'loan-1', { ...edit, schemeId: 'scheme-2', requestedAmount: 8000, tenureMonths: 5 })).rejects.toThrow('scheme is unavailable');

        db.tx.staffLoanScheme.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => where.id === 'scheme-2' ? otherScheme : mockScheme);
        await expect(editApplicationTerms(reviewerActor, 'loan-1', { ...edit, schemeId: 'scheme-2', requestedAmount: 20000, tenureMonths: 5 })).rejects.toThrow('exceeds the scheme limit');
        await expect(editApplicationTerms(reviewerActor, 'loan-1', { ...edit, schemeId: 'scheme-2', requestedAmount: 8000, tenureMonths: 12 })).rejects.toThrow('exceeds the scheme limit of 6 months');

        db.tx.staffLoanScheme.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => where.id === 'scheme-2' ? { ...otherScheme, minimumServiceMonths: 600 } : mockScheme);
        await expect(editApplicationTerms(reviewerActor, 'loan-1', { ...edit, schemeId: 'scheme-2', requestedAmount: 8000, tenureMonths: 5 })).rejects.toThrow('completed months of service');
        expect(db.tx.staffLoan.updateMany).not.toHaveBeenCalled();
    });

    it('replaces the supporting document only with a verified file from the borrower\'s folder', async () => {
        const withDoc = { ...edit, document: { fileKey: 'org/employee-emp-1/staff-loan/new.pdf', fileName: 'new.pdf' } };
        docStorage.read.mockResolvedValue({ buffer: Buffer.from('pdf-bytes'), contentType: 'application/pdf' });
        await editApplicationTerms(reviewerActor, 'loan-1', withDoc);
        expect(docStorage.isKeyFor).toHaveBeenCalledWith('emp-1', 'org/employee-emp-1/staff-loan/new.pdf');
        expect(db.tx.staffLoan.updateMany).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ documentKey: 'org/employee-emp-1/staff-loan/new.pdf', documentName: 'new.pdf', documentMimeType: 'application/pdf', documentSize: 9 }),
        }));
        expect((db.tx.staffLoanDecision.create.mock.calls[0][0].data.remarks as string)).toContain('Document replaced (new.pdf)');

        db.tx.staffLoan.updateMany.mockClear();
        docStorage.isKeyFor.mockResolvedValue(false);
        await expect(editApplicationTerms(reviewerActor, 'loan-1', withDoc)).rejects.toThrow('attached document is invalid');
        docStorage.isKeyFor.mockResolvedValue(true);
        docStorage.read.mockResolvedValue({ buffer: Buffer.from('x'), contentType: 'text/html' });
        await expect(editApplicationTerms(reviewerActor, 'loan-1', withDoc)).rejects.toThrow('not an allowed file');
        expect(db.tx.staffLoan.updateMany).not.toHaveBeenCalled();
    });

    it('leaves the existing document untouched when none is sent', async () => {
        await editApplicationTerms(reviewerActor, 'loan-1', edit);
        expect(db.tx.staffLoan.updateMany.mock.calls[0][0].data).not.toHaveProperty('documentKey');
        expect(docStorage.read).not.toHaveBeenCalled();
    });
});

describe('documentUploadTargetForReviewer', () => {
    const underReview = {
        id: 'loan-1', employeeId: 'emp-1', branchId: 'branch-1', status: 'SUBMITTED', currentApprovalLevel: 1, workflowConfig: mockWorkflow,
    };

    it('lets the current-stage reviewer upload into the borrower\'s folder, nobody else', async () => {
        db.tx.staffLoan.findUnique.mockResolvedValue(underReview);
        await expect(documentUploadTargetForReviewer(reviewerActor, 'loan-1')).resolves.toBe('emp-1');
        await expect(documentUploadTargetForReviewer(actor, 'loan-1')).rejects.toMatchObject({ status: 403 });
        const stranger: StaffLoanActor = { userId: 'other', isAdmin: false, branchIds: ['branch-1'], assignments: [{ roleId: 'wrong-role', branchId: 'branch-1', pagePermissions: null }] };
        await expect(documentUploadTargetForReviewer(stranger, 'loan-1')).rejects.toMatchObject({ status: 403 });
    });

    it('refuses once the loan is no longer under review', async () => {
        db.tx.staffLoan.findUnique.mockResolvedValue({ ...underReview, status: 'APPROVED', currentApprovalLevel: null });
        await expect(documentUploadTargetForReviewer(reviewerActor, 'loan-1')).rejects.toMatchObject({ status: 403 });
    });
});

describe('applicationDetail edit options', () => {
    // The stage-1 role holder of the loan's branch: only they (never an admin by role alone) may edit while under review.
    const adminActor: StaffLoanActor = reviewerActor;
    const submitted = {
        id: 'loan-3', loanNumber: 'SL-000003', employeeId: 'emp-1', branchId: 'branch-1', schemeId: 'scheme-1', status: 'SUBMITTED',
        requestedAmount: new Prisma.Decimal(30000), approvedAmount: null, tenureMonths: 12, interestType: 'FLAT',
        annualInterestRate: new Prisma.Decimal(6), recoveryMethod: 'SALARY', purpose: 'x', remarks: '', version: 1,
        currentApprovalLevel: 1, createdAt: new Date(), disbursedAt: null, schemeSnapshot: { name: 'General Staff Loan' },
        employee: mockEmployee, branch: { name: 'Karur Branch' }, workflowConfig: mockWorkflow, decisions: [], schedules: [],
    };

    beforeEach(() => {
        db.tx.staffLoan.findFirst.mockResolvedValue(submitted);
        db.tx.staffLoan.findMany.mockResolvedValue([]);
        db.tx.staffLoan.count.mockResolvedValue(0);
        db.tx.staffLoanWorkflowConfig.findMany.mockResolvedValue([mockWorkflow]);
        db.tx.user.findUnique.mockResolvedValue({ ...mockEmployee, role: 'FDO', dateOfExit: null, confirmationDate: null, department: { name: 'Ops' }, designation: null });
        db.tx.employeeSalaryMaster.findMany.mockResolvedValue([]);
        db.tx.staffLoanScheme.findMany.mockResolvedValue([mockScheme, { ...mockScheme, id: 'scheme-2', code: 'EMG-02', name: 'Emergency Loan' }]);
    });

    it('offers the reviewer the schemes to move the loan to, with eligibility per scheme', async () => {
        const detail = await applicationDetail(adminActor, 'loan-3');
        expect(detail.editOptions?.schemes.map(s => s.id)).toEqual(['scheme-1', 'scheme-2']);
        expect(detail.editOptions?.schemes[0]).toEqual(expect.objectContaining({ maximumAmount: 50000, maximumTenureMonths: 24, interestType: 'FLAT', annualInterestRate: 6 }));
    });

    it('gives no edit options to someone who cannot edit, or once the loan left review', async () => {
        const borrower: StaffLoanActor = { userId: 'emp-1', isAdmin: false, branchIds: ['branch-1'], assignments: [] };
        expect((await applicationDetail(borrower, 'loan-3')).editOptions).toBeNull();
        db.tx.staffLoan.findFirst.mockResolvedValue({ ...submitted, status: 'APPROVED', currentApprovalLevel: null });
        expect((await applicationDetail(adminActor, 'loan-3')).editOptions).toBeNull();
    });
});

describe('staff loan numbers and list counts', () => {
    it('creates new applications with the next short business loan number', async () => {
        db.tx.$queryRaw.mockResolvedValue([{ n: BigInt(7) }]);
        db.tx.user.findUnique.mockResolvedValue(mockEmployee);
        db.tx.staffLoanScheme.findUnique.mockResolvedValue(mockScheme);
        db.tx.staffLoan.count.mockResolvedValue(0);
        db.tx.staffLoan.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
            id: 'loan-new', loanNumber: data.loanNumber, employeeId: actor.userId, branchId: 'branch-1', schemeId: 'scheme-1',
            status: 'DRAFT', requestedAmount: new Prisma.Decimal(30000), approvedAmount: null, tenureMonths: 12,
            interestType: 'FLAT', annualInterestRate: new Prisma.Decimal(6), recoveryMethod: 'SALARY', purpose: 'x', remarks: '',
            version: 1, currentApprovalLevel: null, createdAt: new Date(), schemeSnapshot: { name: 'General Staff Loan' },
            employee: mockEmployee, branch: { name: 'Karur Branch' }, workflowConfig: null,
        }));
        const res = await saveApplication(actor, {
            schemeId: 'scheme-1', requestedAmount: 30000, tenureMonths: 12, recoveryMethod: 'SALARY', purpose: 'x', remarks: '',
            document: { fileKey: 'org/employee-emp-1/staff-loan/slip.jpg', fileName: 'slip.jpg' },
        }, false);
        expect(res.loanNumber).toBe('SL-000007');
        expect(res.loanNumber).not.toMatch(/-.*-.*-/); // never the long UUID form
    });

    it('adds real total/completed loan counts per employee to the list rows', async () => {
        const adminActor: StaffLoanActor = { userId: 'admin-1', isAdmin: true, branchIds: null, assignments: [] };
        const row = {
            id: 'loan-1', loanNumber: 'SL-000003', employeeId: 'emp-1', branchId: 'branch-1', schemeId: 'scheme-1', status: 'SUBMITTED',
            requestedAmount: new Prisma.Decimal(30000), approvedAmount: null, tenureMonths: 12, interestType: 'MONTHLY',
            annualInterestRate: new Prisma.Decimal(1), recoveryMethod: 'SALARY', purpose: 'x', remarks: '', version: 1,
            currentApprovalLevel: 1, createdAt: new Date(), schemeSnapshot: { name: 'General Staff Loan' },
            employee: mockEmployee, branch: { name: 'Karur Branch' }, workflowConfig: mockWorkflow,
        };
        db.tx.staffLoan.findMany.mockResolvedValue([row]);
        db.tx.staffLoan.count.mockResolvedValue(1);
        db.tx.staffLoan.groupBy.mockResolvedValue([
            { employeeId: 'emp-1', status: 'CLOSED', _count: { _all: 2 } },
            { employeeId: 'emp-1', status: 'ACTIVE', _count: { _all: 1 } },
            { employeeId: 'emp-1', status: 'SUBMITTED', _count: { _all: 1 } },
        ]);
        const list = await listApplications(adminActor, 'register', 1);
        expect(list.items[0].totalLoans).toBe(4);
        expect(list.items[0].completedLoans).toBe(2);
        // Interest is delivered as an amount: 30000 @ 1% monthly for 12 months
        expect(list.items[0].interestAmount).toBe(3600);
        expect(list.items[0].totalPayable).toBe(33600);
        expect(list.items[0].monthlyInstallment).toBe(2800);
    });
});

describe('cancelApplication', () => {
    it('cancels application when owned by actor and version matches', async () => {
        db.tx.staffLoan.updateMany.mockResolvedValue({ count: 1 });

        const res = await cancelApplication(actor, 'loan-1', 1);
        expect(res.status).toBe('CANCELLED');
        expect(db.tx.staffLoan.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ id: 'loan-1', employeeId: actor.userId, version: 1 }),
                data: expect.objectContaining({ status: 'CANCELLED' }),
            })
        );
    });

    it('throws 409 if application was already updated or not eligible for cancel', async () => {
        db.tx.staffLoan.updateMany.mockResolvedValue({ count: 0 });

        await expect(cancelApplication(actor, 'loan-1', 1))
            .rejects.toMatchObject({ status: 409 });
    });
});

describe('disburseLoan', () => {
    const disburseActor: StaffLoanActor = {
        userId: 'cashier-user',
        isAdmin: false,
        branchIds: ['branch-1'],
        assignments: [{ roleId: 'cashier-role', branchId: 'branch-1', pagePermissions: null }],
    };

    const approvedLoan = {
        id: 'loan-1',
        loanNumber: 'SL-001',
        employeeId: 'emp-1',
        branchId: 'branch-1',
        status: 'APPROVED',
        requestedAmount: new Prisma.Decimal(24000),
        approvedAmount: new Prisma.Decimal(24000),
        tenureMonths: 12,
        interestType: 'FLAT' as const,
        annualInterestRate: new Prisma.Decimal(10),
        version: 1,
        workflowConfig: mockWorkflow,
    };

    const disburseInput = {
        id: 'loan-1',
        expectedVersion: 1,
        disbursementDate: '2026-09-10',
        paymentMode: 'BANK_TRANSFER' as const,
        reference: 'UTR998877',
        firstDueDate: '2026-10-10',
        remarks: 'Disbursed via direct credit',
    };

    it('successfully disburses an approved loan, generates schedules, and sets status ACTIVE', async () => {
        db.tx.staffLoan.findUnique.mockResolvedValue(approvedLoan);
        db.tx.user.findUnique.mockResolvedValue(mockEmployee);
        db.tx.staffLoanSchedule.createMany.mockResolvedValue({ count: 12 });
        db.tx.staffLoanTransaction.create.mockResolvedValue({ id: 'tx-1' });
        db.tx.staffLoan.updateMany.mockResolvedValue({ count: 1 });

        const result = await disburseLoan(disburseActor, disburseInput);
        expect(result.status).toBe('ACTIVE');
        expect(result.loanNumber).toBe('SL-001');

        expect(db.tx.staffLoanSchedule.createMany).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.arrayContaining([
                    expect.objectContaining({ installmentNo: 1, loanId: 'loan-1' }),
                ]),
            })
        );
        expect(db.tx.staffLoanTransaction.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    loanId: 'loan-1',
                    type: 'DISBURSEMENT',
                    status: 'POSTED',
                    paymentMode: 'BANK_TRANSFER',
                }),
            })
        );
        expect(db.tx.staffLoan.updateMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ id: 'loan-1', version: 1, status: 'APPROVED' }),
                data: expect.objectContaining({ status: 'ACTIVE' }),
            })
        );
    });

    it('refuses a bank-transfer disbursement without a reference / UTR, and posts nothing', async () => {
        db.tx.staffLoan.findUnique.mockResolvedValue(approvedLoan);
        for (const reference of [null, '', '   ']) {
            await expect(disburseLoan(disburseActor, { ...disburseInput, paymentMode: 'BANK_TRANSFER', reference })).rejects.toThrow('UTR');
        }
        expect(db.tx.staffLoanSchedule.createMany).not.toHaveBeenCalled();
        expect(db.tx.staffLoanTransaction.create).not.toHaveBeenCalled();
        expect(db.tx.staffLoan.updateMany).not.toHaveBeenCalled();
    });

    it('allows a cash disbursement without a reference', async () => {
        db.tx.staffLoan.findUnique.mockResolvedValue(approvedLoan);
        db.tx.user.findUnique.mockResolvedValue(mockEmployee);
        db.tx.staffLoanSchedule.createMany.mockResolvedValue({ count: 12 });
        db.tx.staffLoanTransaction.create.mockResolvedValue({ id: 'tx-1' });
        db.tx.staffLoan.updateMany.mockResolvedValue({ count: 1 });
        await expect(disburseLoan(disburseActor, { ...disburseInput, paymentMode: 'CASH', reference: null })).resolves.toMatchObject({ status: 'ACTIVE' });
        expect(db.tx.staffLoanTransaction.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ paymentMode: 'CASH', reference: null }),
        }));
    });

    it('rejects disbursement if loan is not APPROVED', async () => {
        db.tx.staffLoan.findUnique.mockResolvedValue({ ...approvedLoan, status: 'SUBMITTED' });

        await expect(disburseLoan(disburseActor, disburseInput))
            .rejects.toThrow('Loan is not approved or ready for disbursement.');
    });

    it('rejects disbursement if actor does not have disbursement role', async () => {
        const unauthorizedActor: StaffLoanActor = {
            userId: 'fdo-user',
            isAdmin: false,
            branchIds: ['branch-1'],
            assignments: [{ roleId: 'fdo-role', branchId: 'branch-1', pagePermissions: null }],
        };
        db.tx.staffLoan.findUnique.mockResolvedValue(approvedLoan);

        await expect(disburseLoan(unauthorizedActor, disburseInput))
            .rejects.toMatchObject({ status: 403 });
    });

    it('throws 409 if version does not match', async () => {
        db.tx.staffLoan.findUnique.mockResolvedValue({ ...approvedLoan, version: 2 });

        await expect(disburseLoan(disburseActor, disburseInput))
            .rejects.toMatchObject({ status: 409 });
    });

    describe('with a salary date configured', () => {
        const salaryInput = {
            id: 'loan-1', expectedVersion: 1, disbursementDate: '2026-09-10', paymentMode: 'BANK_TRANSFER' as const,
            reference: 'UTR-SALARY-1', remarks: null,
        };
        const scheduleDates = () => (db.tx.staffLoanSchedule.createMany.mock.calls[0][0].data as { dueDate: Date }[]).map(row => row.dueDate.toISOString().slice(0, 10));

        beforeEach(() => {
            db.tx.staffLoan.findUnique.mockResolvedValue({ ...approvedLoan, tenureMonths: 4, interestType: 'INTEREST_FREE', annualInterestRate: new Prisma.Decimal(0) });
            db.tx.user.findUnique.mockResolvedValue(mockEmployee);
            db.tx.staffLoanSchedule.createMany.mockResolvedValue({ count: 4 });
            db.tx.staffLoanTransaction.create.mockResolvedValue({ id: 'tx-1' });
            db.tx.staffLoan.updateMany.mockResolvedValue({ count: 1 });
        });

        it('builds the whole schedule from the salary date, next month by default', async () => {
            db.tx.staffLoanWorkflowConfig.findFirst.mockResolvedValue({ salaryDay: 5 });
            await disburseLoan(disburseActor, salaryInput);
            expect(scheduleDates()).toEqual(['2026-10-05', '2026-11-05', '2026-12-05', '2027-01-05']);
            expect(db.tx.staffLoan.updateMany).toHaveBeenCalledWith(expect.objectContaining({
                data: expect.objectContaining({ firstDueDate: new Date('2026-10-05') }),
            }));
        });

        it('moves every installment that lands on a Sunday back one day', async () => {
            db.tx.staffLoanWorkflowConfig.findFirst.mockResolvedValue({ salaryDay: 4 }); // 4 Oct 2026 is a Sunday
            await disburseLoan(disburseActor, salaryInput);
            expect(scheduleDates()).toEqual(['2026-10-03', '2026-11-04', '2026-12-04', '2027-01-04']);
        });

        it('starts this month when asked and the salary date is still ahead', async () => {
            db.tx.staffLoanWorkflowConfig.findFirst.mockResolvedValue({ salaryDay: 25 });
            await disburseLoan(disburseActor, { ...salaryInput, firstDueMonth: 'THIS_MONTH' });
            expect(scheduleDates()).toEqual(['2026-09-25', '2026-10-24', '2026-11-25', '2026-12-25']); // 25 Oct is a Sunday
        });

        it('refuses "this month" once that salary date has already passed', async () => {
            db.tx.staffLoanWorkflowConfig.findFirst.mockResolvedValue({ salaryDay: 5 });
            await expect(disburseLoan(disburseActor, { ...salaryInput, firstDueMonth: 'THIS_MONTH' })).rejects.toThrow('already passed');
            expect(db.tx.staffLoanSchedule.createMany).not.toHaveBeenCalled();
            expect(db.tx.staffLoan.updateMany).not.toHaveBeenCalled();
        });

        it('ignores a manually supplied first due date when a salary date exists', async () => {
            db.tx.staffLoanWorkflowConfig.findFirst.mockResolvedValue({ salaryDay: 5 });
            await disburseLoan(disburseActor, { ...salaryInput, firstDueDate: '2026-09-30' });
            expect(scheduleDates()[0]).toBe('2026-10-05');
        });

        it('uses the loan workflow salary date when the latest configuration has none', async () => {
            db.tx.staffLoanWorkflowConfig.findFirst.mockResolvedValue({ salaryDay: null });
            db.tx.staffLoan.findUnique.mockResolvedValue({
                ...approvedLoan, tenureMonths: 4, interestType: 'INTEREST_FREE', annualInterestRate: new Prisma.Decimal(0),
                workflowConfig: { ...mockWorkflow, salaryDay: 10 },
            });
            await disburseLoan(disburseActor, salaryInput);
            expect(scheduleDates()[0]).toBe('2026-10-10');
        });

        it('falls back to the entered first due date, and requires it, when no salary date is set', async () => {
            db.tx.staffLoanWorkflowConfig.findFirst.mockResolvedValue({ salaryDay: null });
            await disburseLoan(disburseActor, { ...salaryInput, firstDueDate: '2026-10-10' });
            expect(scheduleDates()[0]).toBe('2026-10-10');

            db.tx.staffLoanSchedule.createMany.mockClear();
            await expect(disburseLoan(disburseActor, salaryInput)).rejects.toThrow('Enter the first due date');
            expect(db.tx.staffLoanSchedule.createMany).not.toHaveBeenCalled();
        });
    });
});

describe('disbursement list carries the salary date', () => {
    const adminActor: StaffLoanActor = { userId: 'admin-1', isAdmin: true, branchIds: null, assignments: [] };

    it('returns the configured salary day for the disbursements tab only', async () => {
        db.tx.staffLoan.findMany.mockResolvedValue([]);
        db.tx.staffLoan.count.mockResolvedValue(0);
        db.tx.staffLoanWorkflowConfig.findMany.mockResolvedValue([mockWorkflow]);
        db.tx.staffLoanWorkflowConfig.findFirst.mockResolvedValue({ salaryDay: 7 });

        expect((await listApplications(adminActor, 'disbursements', 1)).salaryDay).toBe(7);
        expect((await listApplications(adminActor, 'register', 1)).salaryDay).toBeNull();
    });
});

describe('staff loan repayments and settlement', () => {
    const activeLoan = {
        id: 'loan-active-1',
        loanNumber: 'SL-2026-0001',
        employeeId: 'emp-1',
        branchId: 'branch-1',
        schemeId: 'scheme-1',
        schemeVersion: 1,
        status: 'ACTIVE',
        requestedAmount: new Prisma.Decimal(10000),
        approvedAmount: new Prisma.Decimal(10000),
        tenureMonths: 2,
        interestType: 'FLAT' as const,
        annualInterestRate: new Prisma.Decimal(12),
        recoveryMethod: 'CASH_BANK' as const,
        schemeSnapshot: {},
        version: 1,
        disbursedAt: new Date('2026-09-01'),
        firstDueDate: new Date('2026-10-01'),
        employee: { firstName: 'Arun', lastName: 'Kumar', employeeId: 'EMP001' },
        branch: { name: 'Karur Branch' },
        scheme: {
            name: 'General Staff Loan',
        },
        schedules: [
            {
                id: 'sched-1',
                installmentNo: 1,
                dueDate: new Date('2026-10-01'),
                principalDue: new Prisma.Decimal(5000),
                interestDue: new Prisma.Decimal(100),
                allocations: [],
            },
            {
                id: 'sched-2',
                installmentNo: 2,
                dueDate: new Date('2026-11-01'),
                principalDue: new Prisma.Decimal(5000),
                interestDue: new Prisma.Decimal(100),
                allocations: [],
            },
        ],
        transactions: [
            {
                id: 'tx-disb',
                type: 'DISBURSEMENT',
                status: 'POSTED',
                transactionDate: new Date('2026-09-01'),
                amount: new Prisma.Decimal(10000),
                paymentMode: 'BANK_TRANSFER',
                reference: 'UTR123',
                remarks: null,
                createdAt: new Date('2026-09-01'),
                createdBy: { firstName: 'Manager', lastName: 'User' },
            },
        ],
    };

    const repayActor: StaffLoanActor = {
        userId: 'cashier-1',
        isAdmin: false,
        branchIds: ['branch-1'],
        assignments: [{ roleId: 'bm-role', branchId: 'branch-1', pagePermissions: null }],
    };

    describe('getLoanRepaymentDetails', () => {
        it('calculates totals, schedules, and settlement quote correctly', async () => {
            db.prisma.staffLoan.findUnique.mockResolvedValue(activeLoan);

            const details = await getLoanRepaymentDetails('loan-active-1', repayActor);

            expect(details.loan.loanNumber).toBe('SL-2026-0001');
            expect(details.summary.totalPrincipalDue).toBe(10000);
            expect(details.summary.totalInterestDue).toBe(200);
            expect(details.summary.totalPayable).toBe(10200);
            expect(details.summary.totalOutstanding).toBe(10200);
            expect(details.schedules).toHaveLength(2);
            expect(details.transactions).toHaveLength(1);
            expect(details.earlySettlement.outstandingPrincipal).toBe(10000);
            expect(details.earlySettlement.waivedInterest).toBe(200);
            expect(details.earlySettlement.settlementPayoffAmount).toBe(10000);
        });

        it('rejects if actor lacks branch permission', async () => {
            db.prisma.staffLoan.findUnique.mockResolvedValue(activeLoan);

            const foreignActor: StaffLoanActor = {
                userId: 'foreign-user',
                isAdmin: false,
                branchIds: ['other-branch'],
                assignments: [],
            };

            await expect(getLoanRepaymentDetails('loan-active-1', foreignActor))
                .rejects.toMatchObject({ status: 403 });
        });
    });

    describe('recordRepayment', () => {
        beforeEach(() => {
            db.prisma.$transaction.mockImplementation(async (callback: any) => callback(db.tx));
        });

        it('records partial repayment, allocates interest first, and leaves loan ACTIVE', async () => {
            db.tx.staffLoan.findUnique.mockResolvedValue(activeLoan);
            db.tx.staffLoanTransaction.create.mockResolvedValue({ id: 'tx-repay-1' });
            db.tx.staffLoan.updateMany.mockResolvedValue({ count: 1 });

            const result = await recordRepayment({
                loanId: 'loan-active-1',
                amount: 1000,
                paymentMode: 'CASH',
                paymentDate: '2026-09-10',
                reference: 'CASH001',
                remarks: 'Counter payment',
                expectedVersion: 1,
            }, repayActor);

            expect(result.loanNumber).toBe('SL-2026-0001');
            expect(result.newStatus).toBe('ACTIVE');
            expect(result.remainingBalance).toBe(9200);

            expect(db.tx.staffLoanRepaymentAllocation.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        loanId: 'loan-active-1',
                        scheduleId: 'sched-1',
                    }),
                })
            );
        });

        it('transitions loan status to CLOSED when fully repaid', async () => {
            db.tx.staffLoan.findUnique.mockResolvedValue(activeLoan);
            db.tx.staffLoanTransaction.create.mockResolvedValue({ id: 'tx-repay-full' });
            db.tx.staffLoan.updateMany.mockResolvedValue({ count: 1 });

            const result = await recordRepayment({
                loanId: 'loan-active-1',
                amount: 10200,
                paymentMode: 'BANK_TRANSFER',
                paymentDate: '2026-09-10',
                reference: 'UTR-FULL',
                remarks: 'Full balance payment',
                expectedVersion: 1,
            }, repayActor);

            expect(result.newStatus).toBe('CLOSED');
            expect(result.remainingBalance).toBe(0);
            expect(db.tx.staffLoan.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ status: 'CLOSED' }),
                })
            );
        });

        it('records the waived interest on each installment that was not yet due, and nothing on the others', async () => {
            db.tx.staffLoan.findUnique.mockResolvedValue({ ...activeLoan, transactions: [] });
            db.tx.staffLoanTransaction.create.mockResolvedValue({ id: 'tx-settle-w' });
            db.tx.staffLoan.updateMany.mockResolvedValue({ count: 1 });

            const result = await recordEarlySettlement({
                loanId: 'loan-active-1', paymentMode: 'CASH', settlementDate: '2026-09-10', reference: null, remarks: null, expectedVersion: 1,
            } as any, repayActor);

            const waivedWrites = db.tx.staffLoanSchedule.update.mock.calls.map((c: any) => Number(c[0].data.interestWaived));
            expect(waivedWrites.length).toBeGreaterThan(0);
            expect(waivedWrites.reduce((sum: number, n: number) => sum + n, 0)).toBe(result.waivedInterest);
            expect(waivedWrites.every((n: number) => n > 0)).toBe(true);
        });

        it('rejects if repayment exceeds outstanding balance', async () => {
            db.tx.staffLoan.findUnique.mockResolvedValue(activeLoan);

            await expect(recordRepayment({
                loanId: 'loan-active-1',
                amount: 20000,
                paymentMode: 'CASH',
                paymentDate: '2026-09-10',
                reference: null,
                remarks: null,
                expectedVersion: 1,
            }, repayActor)).rejects.toThrow('exceeds outstanding balance');
        });

        it('rejects if loan is not ACTIVE', async () => {
            db.tx.staffLoan.findUnique.mockResolvedValue({ ...activeLoan, status: 'CLOSED' });

            await expect(recordRepayment({
                loanId: 'loan-active-1',
                amount: 1000,
                paymentMode: 'CASH',
                paymentDate: '2026-09-10',
                reference: null,
                remarks: null,
                expectedVersion: 1,
            }, repayActor)).rejects.toThrow('Repayment can only be recorded on ACTIVE loans');
        });

        it('rejects with 409 if version collision occurs', async () => {
            db.tx.staffLoan.findUnique.mockResolvedValue({ ...activeLoan, version: 2 });

            await expect(recordRepayment({
                loanId: 'loan-active-1',
                amount: 1000,
                paymentMode: 'CASH',
                paymentDate: '2026-09-10',
                reference: null,
                remarks: null,
                expectedVersion: 1,
            }, repayActor)).rejects.toMatchObject({ status: 409 });
        });
    });

    describe('recordEarlySettlement', () => {
        beforeEach(() => {
            db.prisma.$transaction.mockImplementation(async (callback: any) => callback(db.tx));
        });

        it('processes early settlement, closes loan, and waives future unmatured interest', async () => {
            db.tx.staffLoan.findUnique.mockResolvedValue({ ...activeLoan, transactions: [] });
            db.tx.staffLoanTransaction.create.mockResolvedValue({ id: 'tx-settle-1' });
            db.tx.staffLoan.updateMany.mockResolvedValue({ count: 1 });

            const result = await recordEarlySettlement({
                loanId: 'loan-active-1',
                paymentMode: 'BANK_TRANSFER',
                settlementDate: '2026-09-10',
                reference: 'UTR-SETTLE-001',
                remarks: 'Prepayment full settlement',
                expectedVersion: 1,
            }, repayActor);

            expect(result.loanNumber).toBe('SL-2026-0001');
            expect(result.settlementAmount).toBe(10000);
            expect(result.waivedInterest).toBe(200);

            expect(db.tx.staffLoanTransaction.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        loanId: 'loan-active-1',
                        type: 'EARLY_SETTLEMENT',
                        status: 'POSTED',
                    }),
                })
            );

            expect(db.tx.staffLoan.updateMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({ status: 'CLOSED' }),
                })
            );
        });

        const settle = (over: Record<string, unknown> = {}) => recordEarlySettlement({
            loanId: 'loan-active-1',
            paymentMode: 'CASH',
            settlementDate: '2026-09-10',
            reference: null,
            remarks: null,
            expectedVersion: 1,
            ...over,
        } as any, repayActor);

        it('refuses while a payroll deduction is pending, so the same installment is never collected twice', async () => {
            db.tx.staffLoan.findUnique.mockResolvedValue({ ...activeLoan, transactions: [{ id: 'pending-payroll' }] });
            await expect(settle()).rejects.toMatchObject({ status: 409 });
            expect(db.tx.staffLoanTransaction.create).not.toHaveBeenCalled();
        });

        it('refuses a settlement date in the future or before the loan was disbursed', async () => {
            db.tx.staffLoan.findUnique.mockResolvedValue({ ...activeLoan, transactions: [] });
            await expect(settle({ settlementDate: '2999-01-01' })).rejects.toMatchObject({ status: 400 });
            await expect(settle({ settlementDate: '2026-08-15' })).rejects.toMatchObject({ status: 400 });
            expect(db.tx.staffLoanTransaction.create).not.toHaveBeenCalled();
        });

        it('refuses when the amount the user was quoted no longer matches the ledger', async () => {
            db.tx.staffLoan.findUnique.mockResolvedValue({ ...activeLoan, transactions: [] });
            await expect(settle({ expectedAmount: 9000 })).rejects.toMatchObject({ status: 409 });
            expect(db.tx.staffLoanTransaction.create).not.toHaveBeenCalled();
        });

        it('accepts the quoted amount when it matches', async () => {
            db.tx.staffLoan.findUnique.mockResolvedValue({ ...activeLoan, transactions: [] });
            db.tx.staffLoanTransaction.create.mockResolvedValue({ id: 'tx-settle-2' });
            db.tx.staffLoan.updateMany.mockResolvedValue({ count: 1 });
            await expect(settle({ expectedAmount: 10000 })).resolves.toMatchObject({ settlementAmount: 10000 });
        });
    });
});


describe('applicationDetail', () => {
    const adminActor: StaffLoanActor = { userId: 'admin-1', isAdmin: true, branchIds: null, assignments: [] };
    const alloc = (principal: number, interest: number, date: string) => ({ principal: new Prisma.Decimal(principal), interest: new Prisma.Decimal(interest), transaction: { transactionDate: new Date(date) } });
    const currentLoan = {
        id: 'loan-2', loanNumber: 'SL-000002', employeeId: 'emp-1', branchId: 'branch-1', schemeId: 'scheme-1', status: 'ACTIVE',
        requestedAmount: new Prisma.Decimal(10000), approvedAmount: new Prisma.Decimal(10000), tenureMonths: 2,
        interestType: 'FLAT', annualInterestRate: new Prisma.Decimal(12), recoveryMethod: 'SALARY', purpose: 'Repairs', remarks: '',
        version: 3, currentApprovalLevel: null, createdAt: new Date('2026-08-01'), disbursedAt: new Date('2026-09-01'),
        schemeSnapshot: { name: 'General Staff Loan' }, employee: mockEmployee, branch: { name: 'Karur Branch' }, workflowConfig: mockWorkflow,
        decisions: [],
        schedules: [
            { id: 's1', installmentNo: 1, dueDate: new Date('2026-10-01'), principalDue: new Prisma.Decimal(5000), interestDue: new Prisma.Decimal(100), allocations: [alloc(5000, 100, '2026-09-20')] },
            { id: 's2', installmentNo: 2, dueDate: new Date('2099-11-01'), principalDue: new Prisma.Decimal(5000), interestDue: new Prisma.Decimal(100), allocations: [] },
        ],
    };
    const closedLoan = {
        id: 'loan-1', loanNumber: 'SL-000001', status: 'CLOSED', requestedAmount: new Prisma.Decimal(6000), approvedAmount: new Prisma.Decimal(6000),
        tenureMonths: 2, interestType: 'INTEREST_FREE', annualInterestRate: new Prisma.Decimal(0), createdAt: new Date('2025-01-10'),
        submittedAt: new Date('2025-01-11'), disbursedAt: new Date('2025-01-20'), closedAt: new Date('2025-03-20'),
        schedules: [
            { id: 'c1', installmentNo: 1, dueDate: new Date('2025-02-20'), principalDue: new Prisma.Decimal(3000), interestDue: new Prisma.Decimal(0), allocations: [alloc(3000, 0, '2025-02-19')] },
            { id: 'c2', installmentNo: 2, dueDate: new Date('2025-03-20'), principalDue: new Prisma.Decimal(3000), interestDue: new Prisma.Decimal(0), allocations: [alloc(3000, 0, '2025-03-20')] },
        ],
    };

    beforeEach(() => {
        db.tx.staffLoan.findFirst.mockResolvedValue(currentLoan);
        db.tx.staffLoan.findMany.mockResolvedValue([closedLoan]);
        db.tx.user.findUnique.mockResolvedValue({
            id: 'emp-1', employeeId: 'EMP001', firstName: 'Arun', lastName: 'Kumar', isActive: true, role: 'FDO',
            dateOfJoining: new Date('2024-01-01'), dateOfExit: null, confirmationDate: new Date('2024-07-01'),
            branch: { name: 'Karur Branch' }, department: { name: 'Operations' }, designation: { name: 'Field Officer' },
        });
        db.tx.employeeSalaryMaster.findMany.mockResolvedValue([
            { amount: new Prisma.Decimal(20000), salaryComponent: { name: 'Basic', type: 'EARNINGS' } },
            { amount: new Prisma.Decimal(5000), salaryComponent: { name: 'HRA', type: 'EARNINGS' } },
            { amount: new Prisma.Decimal(1800), salaryComponent: { name: 'PF', type: 'DEDUCTIONS' } },
        ]);
    });

    it('returns the loan, employee profile, complete past-loan history and repayment track', async () => {
        const detail = await applicationDetail(adminActor, 'loan-2');

        expect(detail.loanNumber).toBe('SL-000002');
        expect(detail.interestAmount).toBe(200); // 10000 @ 12% flat for 2 months
        expect(detail.totalPayable).toBe(10200);
        expect(detail.monthlyInstallment).toBe(5100);
        expect(detail.disbursementStatus).toBe('Disbursed');

        expect(detail.employee).toMatchObject({
            name: 'Arun Kumar', employeeId: 'EMP001', department: 'Operations', designation: 'Field Officer', branch: 'Karur Branch',
            employmentStatus: 'Active', dateOfJoining: '2024-01-01', grossSalary: 25000, monthlyCtc: null,
        });
        expect(detail.employee.experience).toMatch(/yr|year/);
        expect(detail.employee.salaryComponents).toHaveLength(3);

        expect(detail.pastLoans).toEqual([expect.objectContaining({
            loanNumber: 'SL-000001', status: 'CLOSED', loanAmount: 6000, interestAmount: 0, totalPayable: 6000,
            paidAmount: 6000, outstandingAmount: 0, tenureMonths: 2,
        })]);
        expect(detail.pastLoans[0].closedAt).toContain('2025-03-20');
        // Each past loan carries its OWN repayment track (never merged with the viewed loan's).
        expect(detail.pastLoans[0].schedules).toHaveLength(2);
        expect(detail.pastLoans[0].schedules!.every(s => s.status === 'PAID')).toBe(true);
        expect(detail.pastLoans[0].schedules!.reduce((sum, s) => sum + s.totalDue, 0)).toBe(6000);
        expect(detail.repayment!.schedules.reduce((sum, s) => sum + s.totalDue, 0)).toBe(10200);
        expect(db.tx.staffLoan.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ employeeId: 'emp-1', id: { not: 'loan-2' } }),
        }));

        expect(detail.repayment).toMatchObject({ paidAmount: 5100, outstandingAmount: 5100, remainingPrincipal: 5000 });
        expect(detail.repayment!.schedules).toEqual([
            expect.objectContaining({ installmentNo: 1, status: 'PAID', totalDue: 5100, totalPaid: 5100, totalOutstanding: 0, paymentDate: '2026-09-20' }),
            expect.objectContaining({ installmentNo: 2, status: 'PENDING', totalDue: 5100, totalPaid: 0, totalOutstanding: 5100, paymentDate: null }),
        ]);
    });

    it('does not list an unrestricted scope as an OR branch (Prisma would match nothing, hiding ACTIVE loans from admins)', async () => {
        await applicationDetail(adminActor, 'loan-2');
        expect(db.tx.staffLoan.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'loan-2' } }));
    });

    it('still restricts a non-admin to loans they applied for or are assigned to review', async () => {
        db.tx.staffLoanWorkflowConfig.findMany.mockResolvedValue([mockWorkflow]);
        db.tx.staffLoan.findFirst.mockResolvedValue(null);
        await expect(applicationDetail(reviewerActor, 'loan-2')).rejects.toMatchObject({ status: 404 });
        const where = db.tx.staffLoan.findFirst.mock.calls[0][0].where;
        expect(where.id).toBe('loan-2');
        expect(where.OR).toEqual(expect.arrayContaining([{ employeeId: reviewerActor.userId }]));
    });

    it('has no repayment track before disbursement', async () => {
        db.tx.staffLoan.findFirst.mockResolvedValue({ ...currentLoan, status: 'APPROVED', disbursedAt: null, schedules: [] });
        const detail = await applicationDetail(adminActor, 'loan-2');
        expect(detail.repayment).toBeNull();
        expect(detail.disbursementStatus).toBe('Awaiting disbursement');
    });
});
