import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { UserContext } from '@/app/lib/permissions/types';

// Mock DB and external services
const db = vi.hoisted(() => {
  const employeeConfirmation = {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  const user = {
    findUnique: vi.fn(),
    update: vi.fn(),
  };
  const approvalInstance = {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
  };
  const tx = {
    employeeConfirmation,
    user,
    approvalInstance,
  };
  return {
    employeeConfirmation,
    user,
    approvalInstance,
    tx,
    prisma: {
      ...tx,
      $transaction: vi.fn(async (cb: (txClient: typeof tx) => Promise<unknown>) => cb(tx)),
    },
  };
});

vi.mock('@/app/lib/db', () => ({
  prisma: db.prisma,
}));

vi.mock('@/app/lib/prisma', () => ({
  prisma: db.prisma,
}));

const mockPermissions = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  isUserContext: vi.fn((ctx: unknown) => ctx && typeof ctx === 'object' && 'userId' in ctx),
  isEmployeeBranchPermitted: vi.fn().mockReturnValue(true),
}));

vi.mock('@/app/lib/permissions/branch-scope', () => ({
    // Mirrors the RBAC context's branch list so these tests keep exercising the route logic only.
    getPermittedBranchIdsForContext: async (ctx: { isHeadOffice?: boolean; branchAccess?: { branchId: string }[] }) =>
        ctx.isHeadOffice ? null : (ctx.branchAccess ?? []).map((ba) => ba.branchId),
}));

vi.mock('@/app/lib/permissions/guards', () => ({
  requirePermission: mockPermissions.requirePermission,
  isUserContext: mockPermissions.isUserContext,
  isEmployeeBranchPermitted: mockPermissions.isEmployeeBranchPermitted,
  // Routes now call the async org-scope-aware variant; the tests drive both through the same mock.
  isEmployeeInCallerScope: async (...args: unknown[]) => (mockPermissions.isEmployeeBranchPermitted as (...a: unknown[]) => unknown)(...args),
}));

const mockEngine = vi.hoisted(() => ({
  startApprovalWorkflow: vi.fn(),
  processStageAction: vi.fn(),
  cancelApprovalForRecord: vi.fn(),
}));

vi.mock('@/app/lib/approval/engine', () => ({
  startApprovalWorkflow: mockEngine.startApprovalWorkflow,
  processStageAction: mockEngine.processStageAction,
  cancelApprovalForRecord: mockEngine.cancelApprovalForRecord,
}));

vi.mock('@/app/lib/approval/record-approval', () => ({
  describePendingApprovals: vi.fn().mockResolvedValue(new Map()),
}));

const mockPdf = vi.hoisted(() => ({
  buildConfirmationLetterPdf: vi.fn().mockResolvedValue(Buffer.from('mock-pdf')),
}));

vi.mock('@/app/lib/reports/confirmation-letter-pdf', () => ({
  buildConfirmationLetterPdf: mockPdf.buildConfirmationLetterPdf,
}));

const mockStorage = vi.hoisted(() => ({
  uploadHrLetter: vi.fn().mockResolvedValue('https://storage/letter.pdf'),
}));

vi.mock('@/app/lib/storage/hr-letter-storage', () => ({
  uploadHrLetter: mockStorage.uploadHrLetter,
}));

import { POST as createConfirmation, GET as getConfirmations } from './route';
import { POST as approveConfirmation } from './[id]/approve/route';
import { POST as rejectConfirmation } from './[id]/reject/route';

describe('HR Confirmation Approval Engine Migration', () => {
  const createMockUserContext = (overrides: Partial<UserContext> = {}): UserContext => ({
    userId: 'user-submitter',
    email: 'submitter@example.com',
    firstName: 'Submitter',
    lastName: 'User',
    isActive: true,
    branchId: 'branch-1',
    isHeadOffice: false,
    roles: [{ roleId: 'r1', roleName: 'HR Officer', roleSlug: 'hr_officer', priority: 5, branchId: null }],
    permissions: { granted: new Set(), denied: new Set(), conditions: new Map() },
    branchAccess: [
      {
        branchId: 'branch-1',
        branchCode: 'BR01',
        branchName: 'Branch 1',
        accessType: 'FULL',
        isPrimary: true,
        isHeadOffice: false,
      },
    ],
    fieldPermissions: new Map(),
    reportPermissions: new Map(),
    ...overrides,
  });

  const mockUser = createMockUserContext();

  const mockAdminUser = createMockUserContext({
    userId: 'user-admin',
    roles: [{ roleId: 'r0', roleName: 'Admin', roleSlug: 'admin', priority: 1, branchId: null }],
    isHeadOffice: true,
  });

  const mockApproverUser = createMockUserContext({
    userId: 'user-approver',
    roles: [{ roleId: 'r2', roleName: 'Branch Manager', roleSlug: 'branch-manager', priority: 4, branchId: null }],
  });

  const mockEmployee = {
    id: 'emp-1',
    firstName: 'Alice',
    lastName: 'Smith',
    employeeId: 'EMP-101',
    branchId: 'branch-1',
    confirmationDate: null,
    designation: { name: 'Officer' },
    department: { name: 'Operations' },
    branch: { name: 'City Branch' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPermissions.isEmployeeBranchPermitted.mockReturnValue(true);
  });

  // A. New confirmation submission
  it('Case A: New confirmation submission creates PENDING confirmation, starts workflow, and stores approvalInstanceId', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockUser);
    db.user.findUnique.mockResolvedValue(mockEmployee);
    db.employeeConfirmation.findFirst.mockResolvedValue(null);

    const createdRecord = {
      id: 'conf-123',
      employeeId: 'emp-1',
      proposedConfirmationDate: new Date('2026-10-01'),
      status: 'PENDING',
      initiatedById: mockUser.userId,
      approvalInstanceId: null,
    };
    db.employeeConfirmation.create.mockResolvedValue(createdRecord);

    mockEngine.startApprovalWorkflow.mockResolvedValue({
      instanceId: 'inst-999',
      workflowName: 'Admin-Only Confirmation Approval',
    });
    db.approvalInstance.findUnique.mockResolvedValue({ id: 'inst-999', status: 'PENDING' });

    const updatedWithInstance = {
      ...createdRecord,
      approvalInstanceId: 'inst-999',
    };
    db.employeeConfirmation.update.mockResolvedValue(updatedWithInstance);

    const req = new NextRequest('http://localhost:3320/api/hr/confirmations', {
      method: 'POST',
      body: JSON.stringify({
        employeeId: 'emp-1',
        proposedConfirmationDate: '2026-10-01',
      }),
    });

    const res = await createConfirmation(req);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.data.approvalInstanceId).toBe('inst-999');
    expect(json.data.status).toBe('PENDING');
    expect(mockEngine.startApprovalWorkflow).toHaveBeenCalledWith({
      moduleSlug: 'hr-confirmation',
      recordType: 'hr_confirmation',
      recordId: 'conf-123',
      branchId: 'branch-1',
      submittedByUserId: mockUser.userId,
    });
    // Side effects must NOT execute on initial submission
    expect(mockPdf.buildConfirmationLetterPdf).not.toHaveBeenCalled();
    expect(mockStorage.uploadHrLetter).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  // B. Non-admin self-approval
  it('Case B: Non-admin initiator attempting self-approval is rejected with 400 and no side effects execute', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockUser);

    const confirmation = {
      id: 'conf-123',
      employeeId: 'emp-1',
      proposedConfirmationDate: new Date('2026-10-01'),
      status: 'PENDING',
      initiatedById: mockUser.userId,
      approvalInstanceId: 'inst-999',
      employee: mockEmployee,
    };
    db.employeeConfirmation.findUnique.mockResolvedValue(confirmation);

    // Engine throws "Self-approval is not allowed"
    mockEngine.processStageAction.mockRejectedValue(new Error('Self-approval is not allowed'));

    const req = new NextRequest('http://localhost:3320/api/hr/confirmations/conf-123/approve', {
      method: 'POST',
    });

    const res = await approveConfirmation(req, { params: Promise.resolve({ id: 'conf-123' }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Self-approval is not allowed');
    expect(mockPdf.buildConfirmationLetterPdf).not.toHaveBeenCalled();
    expect(mockStorage.uploadHrLetter).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  // C. Admin self-approval
  it('Case C: Admin initiator self-approves successfully and side effects execute exactly once', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockAdminUser);

    const confirmation = {
      id: 'conf-123',
      employeeId: 'emp-1',
      proposedConfirmationDate: new Date('2026-10-01'),
      status: 'PENDING',
      initiatedById: mockAdminUser.userId,
      approvalInstanceId: 'inst-999',
      employee: mockEmployee,
    };
    db.employeeConfirmation.findUnique.mockResolvedValue(confirmation);

    mockEngine.processStageAction.mockResolvedValue({
      newStatus: 'APPROVED',
      nextStage: null,
    });

    const approvedRecord = {
      ...confirmation,
      status: 'APPROVED',
      reviewedById: mockAdminUser.userId,
      reviewedAt: new Date(),
      letterUrl: 'https://storage/letter.pdf',
    };
    db.employeeConfirmation.update.mockResolvedValue(approvedRecord);

    const req = new NextRequest('http://localhost:3320/api/hr/confirmations/conf-123/approve', {
      method: 'POST',
    });

    const res = await approveConfirmation(req, { params: Promise.resolve({ id: 'conf-123' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockEngine.processStageAction).toHaveBeenCalledWith(
      { instanceId: 'inst-999', actorUserId: mockAdminUser.userId, action: 'approve' },
      mockAdminUser
    );
    expect(mockPdf.buildConfirmationLetterPdf).toHaveBeenCalledTimes(1);
    expect(mockStorage.uploadHrLetter).toHaveBeenCalledTimes(1);
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 'emp-1' },
      data: { confirmationDate: confirmation.proposedConfirmationDate },
    });
  });

  // D. Normal approver
  it('Case D: Different authorized approver approves, letter generated and confirmationDate updated', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockApproverUser);

    const confirmation = {
      id: 'conf-123',
      employeeId: 'emp-1',
      proposedConfirmationDate: new Date('2026-10-01'),
      status: 'PENDING',
      initiatedById: mockUser.userId, // initiated by another user
      approvalInstanceId: 'inst-999',
      employee: mockEmployee,
    };
    db.employeeConfirmation.findUnique.mockResolvedValue(confirmation);

    mockEngine.processStageAction.mockResolvedValue({
      newStatus: 'APPROVED',
      nextStage: null,
    });

    const approvedRecord = {
      ...confirmation,
      status: 'APPROVED',
      reviewedById: mockApproverUser.userId,
      reviewedAt: new Date(),
      letterUrl: 'https://storage/letter.pdf',
    };
    db.employeeConfirmation.update.mockResolvedValue(approvedRecord);

    const req = new NextRequest('http://localhost:3320/api/hr/confirmations/conf-123/approve', {
      method: 'POST',
    });

    const res = await approveConfirmation(req, { params: Promise.resolve({ id: 'conf-123' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockPdf.buildConfirmationLetterPdf).toHaveBeenCalledTimes(1);
    expect(mockStorage.uploadHrLetter).toHaveBeenCalledTimes(1);
    expect(db.user.update).toHaveBeenCalledTimes(1);
  });

  it('Case D2: Resumes an approval whose instance already cleared but whose letter step failed earlier', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockApproverUser);
    const confirmation = {
      id: 'conf-123',
      employeeId: 'emp-1',
      proposedConfirmationDate: new Date('2026-10-01'),
      status: 'PENDING',
      initiatedById: mockUser.userId,
      approvalInstanceId: 'inst-999',
      employee: mockEmployee,
    };
    db.employeeConfirmation.findUnique.mockResolvedValue(confirmation);
    mockEngine.processStageAction.mockRejectedValue(new Error("Instance is in 'APPROVED' state, cannot process"));
    db.employeeConfirmation.update.mockResolvedValue({ ...confirmation, status: 'APPROVED' });

    const req = new NextRequest('http://localhost:3320/api/hr/confirmations/conf-123/approve', { method: 'POST' });
    const res = await approveConfirmation(req, { params: Promise.resolve({ id: 'conf-123' }) });

    expect(res.status).toBe(200);
    expect(mockPdf.buildConfirmationLetterPdf).toHaveBeenCalledTimes(1);
    expect(db.user.update).toHaveBeenCalledTimes(1);
  });

  it('Case A2: A workflow that cannot start rolls the request back instead of confirming without approval', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockUser);
    db.user.findUnique.mockResolvedValue(mockEmployee);
    db.employeeConfirmation.findFirst.mockResolvedValue(null);
    db.employeeConfirmation.create.mockResolvedValue({ id: 'conf-err', employeeId: 'emp-1', status: 'PENDING' });
    mockEngine.startApprovalWorkflow.mockRejectedValue(new Error('Workflow has no stages configured'));

    const req = new NextRequest('http://localhost:3320/api/hr/confirmations', {
      method: 'POST',
      body: JSON.stringify({ employeeId: 'emp-1', proposedConfirmationDate: '2026-10-01' }),
    });
    const res = await createConfirmation(req);
    expect(mockEngine.cancelApprovalForRecord).toHaveBeenCalledWith('hr_confirmation', 'conf-err', mockUser.userId);

    expect(res.status).toBe(500);
    expect(db.employeeConfirmation.delete).toHaveBeenCalledWith({ where: { id: 'conf-err' } });
    expect(mockPdf.buildConfirmationLetterPdf).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  it('Case A3: An inactive employee cannot be confirmed', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockUser);
    db.user.findUnique.mockResolvedValue({ ...mockEmployee, isActive: false });

    const req = new NextRequest('http://localhost:3320/api/hr/confirmations', {
      method: 'POST',
      body: JSON.stringify({ employeeId: 'emp-1', proposedConfirmationDate: '2026-10-01' }),
    });
    const res = await createConfirmation(req);

    expect(res.status).toBe(409);
    expect(db.employeeConfirmation.create).not.toHaveBeenCalled();
  });

  // E. Intermediate stage
  it('Case E: First stage approval keeps status PENDING and does NOT execute letter generation or confirmationDate update', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockApproverUser);

    const confirmation = {
      id: 'conf-123',
      employeeId: 'emp-1',
      proposedConfirmationDate: new Date('2026-10-01'),
      status: 'PENDING',
      initiatedById: mockUser.userId,
      approvalInstanceId: 'inst-999',
      employee: mockEmployee,
    };
    db.employeeConfirmation.findUnique.mockResolvedValue(confirmation);

    // Intermediate stage transition: newStatus is IN_PROGRESS, next stage is HR Final Review
    mockEngine.processStageAction.mockResolvedValue({
      newStatus: 'IN_PROGRESS',
      nextStage: 'HR Final Review',
    });

    const req = new NextRequest('http://localhost:3320/api/hr/confirmations/conf-123/approve', {
      method: 'POST',
    });

    const res = await approveConfirmation(req, { params: Promise.resolve({ id: 'conf-123' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.message).toContain('HR Final Review');
    expect(json.data.status).toBe('PENDING');
    // Side effects must NOT execute for intermediate stage
    expect(mockPdf.buildConfirmationLetterPdf).not.toHaveBeenCalled();
    expect(mockStorage.uploadHrLetter).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
    expect(db.employeeConfirmation.update).not.toHaveBeenCalled();
  });

  // F. Rejection
  it('Case F: Workflow rejected sets status REJECTED with reviewRemarks and no side effects execute', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockApproverUser);

    const confirmation = {
      id: 'conf-123',
      employeeId: 'emp-1',
      status: 'PENDING',
      initiatedById: mockUser.userId,
      approvalInstanceId: 'inst-999',
      employee: mockEmployee,
    };
    db.employeeConfirmation.findUnique.mockResolvedValue(confirmation);

    mockEngine.processStageAction.mockResolvedValue({
      newStatus: 'REJECTED',
      nextStage: null,
    });

    const rejectedRecord = {
      ...confirmation,
      status: 'REJECTED',
      reviewedById: mockApproverUser.userId,
      reviewedAt: new Date(),
      reviewRemarks: 'Probation period extended due to performance review',
    };
    db.employeeConfirmation.update.mockResolvedValue(rejectedRecord);

    const req = new NextRequest('http://localhost:3320/api/hr/confirmations/conf-123/reject', {
      method: 'POST',
      body: JSON.stringify({ reviewRemarks: 'Probation period extended due to performance review' }),
    });

    const res = await rejectConfirmation(req, { params: Promise.resolve({ id: 'conf-123' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('REJECTED');
    expect(mockEngine.processStageAction).toHaveBeenCalledWith(
      {
        instanceId: 'inst-999',
        actorUserId: mockApproverUser.userId,
        action: 'reject',
        remarks: 'Probation period extended due to performance review',
      },
      mockApproverUser
    );
    expect(mockPdf.buildConfirmationLetterPdf).not.toHaveBeenCalled();
    expect(mockStorage.uploadHrLetter).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  // G. Legacy row
  it('Case G: Legacy row with approvalInstanceId = null follows legacy path and does not fabricate an instance', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockApproverUser);

    const legacyConfirmation = {
      id: 'conf-legacy-456',
      employeeId: 'emp-1',
      proposedConfirmationDate: new Date('2026-09-15'),
      status: 'PENDING',
      initiatedById: 'user-other',
      approvalInstanceId: null, // Legacy row has no instance!
      employee: mockEmployee,
    };
    db.employeeConfirmation.findUnique.mockResolvedValue(legacyConfirmation);

    const approvedRecord = {
      ...legacyConfirmation,
      status: 'APPROVED',
      reviewedById: mockApproverUser.userId,
      reviewedAt: new Date(),
      letterUrl: 'https://storage/letter.pdf',
    };
    db.employeeConfirmation.update.mockResolvedValue(approvedRecord);

    const req = new NextRequest('http://localhost:3320/api/hr/confirmations/conf-legacy-456/approve', {
      method: 'POST',
    });

    const res = await approveConfirmation(req, { params: Promise.resolve({ id: 'conf-legacy-456' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    // Generic engine processStageAction must NOT be called for legacy row
    expect(mockEngine.processStageAction).not.toHaveBeenCalled();
    expect(mockEngine.startApprovalWorkflow).not.toHaveBeenCalled();
    // Legacy side effects still execute
    expect(mockPdf.buildConfirmationLetterPdf).toHaveBeenCalledTimes(1);
    expect(mockStorage.uploadHrLetter).toHaveBeenCalledTimes(1);
    expect(db.user.update).toHaveBeenCalledTimes(1);
  });

  it('GET /api/hr/confirmations returns approvalInstanceId directly from model', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockUser);
    const mockList = [
      {
        id: 'conf-1',
        employeeId: 'emp-1',
        status: 'PENDING',
        approvalInstanceId: 'inst-1',
        employee: mockEmployee,
        initiatedBy: { id: 'u1', firstName: 'John', lastName: 'Doe' },
        reviewedBy: null,
      },
      {
        id: 'conf-legacy',
        employeeId: 'emp-1',
        status: 'APPROVED',
        approvalInstanceId: null,
        employee: mockEmployee,
        initiatedBy: { id: 'u2', firstName: 'Jane', lastName: 'Doe' },
        reviewedBy: { id: 'u3', firstName: 'Boss', lastName: 'Man' },
      },
    ];
    db.employeeConfirmation.findMany.mockResolvedValue(mockList);

    const req = new NextRequest('http://localhost:3320/api/hr/confirmations');
    const res = await getConfirmations(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(2);
    expect(json.data[0].approvalInstanceId).toBe('inst-1');
    expect(json.data[1].approvalInstanceId).toBeNull();
  });
});
