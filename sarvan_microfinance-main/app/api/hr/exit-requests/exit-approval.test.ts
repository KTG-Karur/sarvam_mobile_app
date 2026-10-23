import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { UserContext } from '@/app/lib/permissions/types';

// Mock DB and external services
const db = vi.hoisted(() => {
  const employeeExitRequest = {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  const exitClearanceItemConfig = {
    findMany: vi.fn(),
  };
  const employeeExitClearanceItem = {
    updateMany: vi.fn(),
  };
  const user = {
    findUnique: vi.fn(),
    update: vi.fn(),
  };
  const approvalInstance = {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
  };
  // Exit ↔ Belongings check (app/lib/hr/exit-belongings-check.ts) — defaults to
  // "nothing outstanding" so every existing scenario here (none of which are
  // about belongings) behaves exactly as it did before that check existed.
  const employeeIssuedBelonging = {
    findMany: vi.fn().mockResolvedValue([]),
    groupBy: vi.fn().mockResolvedValue([]),
    count: vi.fn().mockResolvedValue(0),
  };
  const tx = {
    employeeExitRequest,
    exitClearanceItemConfig,
    employeeExitClearanceItem,
    user,
    approvalInstance,
    employeeIssuedBelonging,
  };
  return {
    employeeExitRequest,
    exitClearanceItemConfig,
    employeeExitClearanceItem,
    user,
    approvalInstance,
    employeeIssuedBelonging,
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
  isUserContext: vi.fn((ctx: unknown) => Boolean(ctx && typeof ctx === 'object' && 'userId' in ctx)),
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

const mockRecordApproval = vi.hoisted(() => ({
  describePendingApprovals: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock('@/app/lib/approval/record-approval', () => ({
  describePendingApprovals: mockRecordApproval.describePendingApprovals,
}));

const mockPdf = vi.hoisted(() => ({
  buildRelievingLetterPdf: vi.fn().mockResolvedValue(Buffer.from('mock-relieving-pdf')),
}));

vi.mock('@/app/lib/reports/relieving-letter-pdf', () => ({
  buildRelievingLetterPdf: mockPdf.buildRelievingLetterPdf,
}));

const mockStorage = vi.hoisted(() => ({
  uploadHrLetter: vi.fn().mockResolvedValue('https://storage/relieving-letter.pdf'),
}));

vi.mock('@/app/lib/storage/hr-letter-storage', () => ({
  uploadHrLetter: mockStorage.uploadHrLetter,
}));

vi.mock('@/app/lib/permissions/engine', () => ({
  invalidateUserPermissions: vi.fn().mockResolvedValue(undefined),
}));

import { POST as createExitRequest, GET as getExitRequests } from './route';
import { POST as finalApproveExitRequest } from './[id]/final-approve/route';
import { POST as rejectExitRequest } from './[id]/reject/route';
import { GET as getExitRequestDetail } from './[id]/route';

describe('HR Exit Approval Engine Migration', () => {
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
    firstName: 'John',
    lastName: 'Doe',
    employeeId: 'EMP-001',
    dateOfJoining: new Date('2023-01-01'),
    isActive: true,
    branchId: 'branch-1',
    designation: { name: 'Field Officer' },
    department: { name: 'Operations' },
    branch: { name: 'City Branch' },
  };

  const mockClearanceItemsCleared = [
    { id: 'ci-1', configItemId: 'cfg-1', department: 'IT', itemName: 'Laptop Returned', status: 'CLEARED' },
    { id: 'ci-2', configItemId: 'cfg-2', department: 'ACCOUNTS', itemName: 'No Dues', status: 'CLEARED' },
  ];

  const mockClearanceItemsPending = [
    { id: 'ci-1', configItemId: 'cfg-1', department: 'IT', itemName: 'Laptop Returned', status: 'CLEARED' },
    { id: 'ci-2', configItemId: 'cfg-2', department: 'ACCOUNTS', itemName: 'No Dues', status: 'PENDING' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockPermissions.isEmployeeBranchPermitted.mockReturnValue(true);
  });

  // Scenario 1: Standard Exit request creation -> approvalInstanceId stored
  it('Scenario 1: Standard Exit request creation creates IN_PROGRESS record, starts workflow, and stores approvalInstanceId', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockUser);
    db.user.findUnique.mockResolvedValue(mockEmployee);
    db.employeeExitRequest.findFirst.mockResolvedValue(null);
    db.exitClearanceItemConfig.findMany.mockResolvedValue([
      { id: 'cfg-1', department: 'IT', itemName: 'Laptop Returned', sortOrder: 1 },
    ]);

    const createdRecord = {
      id: 'exit-101',
      employeeId: 'emp-1',
      exitType: 'VOLUNTARY_RESIGNATION',
      requestedDate: new Date('2026-10-01'),
      lastWorkingDate: new Date('2026-10-15'),
      status: 'IN_PROGRESS',
      initiatedById: mockUser.userId,
      approvalInstanceId: null,
      clearanceItems: [{ id: 'ci-1', configItemId: 'cfg-1', department: 'IT', itemName: 'Laptop Returned', status: 'PENDING' }],
    };
    db.employeeExitRequest.create.mockResolvedValue(createdRecord);

    mockEngine.startApprovalWorkflow.mockResolvedValue({
      instanceId: 'inst-exit-101',
      workflowName: 'Admin-Only Exit Approval',
    });
    db.approvalInstance.findUnique.mockResolvedValue({ id: 'inst-exit-101', status: 'PENDING' });

    const updatedPending = {
      ...createdRecord,
      approvalInstanceId: 'inst-exit-101',
      employee: { id: 'emp-1', firstName: 'John', lastName: 'Doe', employeeId: 'EMP-001' },
    };
    db.employeeExitRequest.update.mockResolvedValue(updatedPending);

    const req = new NextRequest('http://localhost:3320/api/hr/exit-requests', {
      method: 'POST',
      body: JSON.stringify({
        employeeId: 'emp-1',
        exitType: 'VOLUNTARY_RESIGNATION',
        requestedDate: '2026-10-01',
        lastWorkingDate: '2026-10-15',
        reason: 'Personal reasons',
      }),
    });

    const res = await createExitRequest(req);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.data.approvalInstanceId).toBe('inst-exit-101');
    expect(json.data.status).toBe('IN_PROGRESS');
    expect(mockEngine.startApprovalWorkflow).toHaveBeenCalledWith({
      moduleSlug: 'hr-exit',
      recordType: 'EmployeeExitRequest',
      recordId: 'exit-101',
      branchId: 'branch-1',
      submittedByUserId: mockUser.userId,
    });
  });

  // Scenario 2: Standard engine-backed Exit request remains pending/in-progress, employee remains active
  it('Scenario 2: Standard engine-backed Exit request remains IN_PROGRESS and employee remains active (zero side effects on creation)', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockUser);
    db.user.findUnique.mockResolvedValue(mockEmployee);
    db.employeeExitRequest.findFirst.mockResolvedValue(null);
    db.exitClearanceItemConfig.findMany.mockResolvedValue([]);

    const createdRecord = {
      id: 'exit-102',
      employeeId: 'emp-1',
      exitType: 'VOLUNTARY_RESIGNATION',
      requestedDate: new Date('2026-10-01'),
      lastWorkingDate: new Date('2026-10-15'),
      status: 'IN_PROGRESS',
      initiatedById: mockUser.userId,
    };
    db.employeeExitRequest.create.mockResolvedValue(createdRecord);

    mockEngine.startApprovalWorkflow.mockResolvedValue({
      instanceId: 'inst-exit-102',
      workflowName: 'Admin-Only Exit Approval',
    });
    db.approvalInstance.findUnique.mockResolvedValue({ id: 'inst-exit-102', status: 'PENDING' });
    db.employeeExitRequest.update.mockResolvedValue({ ...createdRecord, approvalInstanceId: 'inst-exit-102' });

    const req = new NextRequest('http://localhost:3320/api/hr/exit-requests', {
      method: 'POST',
      body: JSON.stringify({
        employeeId: 'emp-1',
        exitType: 'VOLUNTARY_RESIGNATION',
        requestedDate: '2026-10-01',
        lastWorkingDate: '2026-10-15',
      }),
    });

    const res = await createExitRequest(req);
    expect(res.status).toBe(201);

    // No employee deactivation or letters generated
    expect(db.user.update).not.toHaveBeenCalled();
    expect(mockPdf.buildRelievingLetterPdf).not.toHaveBeenCalled();
    expect(mockStorage.uploadHrLetter).not.toHaveBeenCalled();
  });

  // Scenario 3: Intermediate approval -> stage advances, exit remains pending, employee remains active, zero final side effects
  it('Scenario 3: Intermediate approval advances stage, leaves exit IN_PROGRESS, and does not execute side effects', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockApproverUser);

    const exitRequest = {
      id: 'exit-301',
      employeeId: 'emp-1',
      exitType: 'VOLUNTARY_RESIGNATION',
      requestedDate: new Date('2026-10-01'),
      lastWorkingDate: new Date('2026-10-15'),
      status: 'IN_PROGRESS',
      initiatedById: mockUser.userId,
      approvalInstanceId: 'inst-multi',
      employee: mockEmployee,
      clearanceItems: mockClearanceItemsCleared,
    };
    db.employeeExitRequest.findUnique.mockResolvedValue(exitRequest);

    mockEngine.processStageAction.mockResolvedValue({
      newStatus: 'IN_PROGRESS',
      nextStage: 'HR Head Sign-off',
    });

    const req = new NextRequest('http://localhost:3320/api/hr/exit-requests/exit-301/final-approve', {
      method: 'POST',
    });

    const res = await finalApproveExitRequest(req, { params: Promise.resolve({ id: 'exit-301' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.message).toContain('Approved at this level — now awaiting HR Head Sign-off');
    expect(json.data.status).toBe('IN_PROGRESS');

    // Zero side effects on intermediate stage
    expect(mockPdf.buildRelievingLetterPdf).not.toHaveBeenCalled();
    expect(mockStorage.uploadHrLetter).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  // Scenario 4: Final approval -> terminal COMPLETED, employee deactivated, dateOfExit set, relieving letter issued
  it('Scenario 4: Final approval terminates as COMPLETED, deactivates employee, sets dateOfExit, and issues relieving letter', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockAdminUser);

    const exitRequest = {
      id: 'exit-401',
      employeeId: 'emp-1',
      exitType: 'VOLUNTARY_RESIGNATION',
      requestedDate: new Date('2026-10-01'),
      lastWorkingDate: new Date('2026-10-15'),
      status: 'IN_PROGRESS',
      initiatedById: mockUser.userId,
      approvalInstanceId: 'inst-401',
      employee: mockEmployee,
      clearanceItems: mockClearanceItemsCleared,
    };
    db.employeeExitRequest.findUnique.mockResolvedValue(exitRequest);

    mockEngine.processStageAction.mockResolvedValue({
      newStatus: 'APPROVED',
      nextStage: null,
    });

    const updatedCompleted = {
      ...exitRequest,
      status: 'COMPLETED',
      finalHrApprovedById: mockAdminUser.userId,
      finalHrApprovedAt: new Date(),
      ndcGeneratedAt: new Date(),
      relievingLetterUrl: 'https://storage/relieving-letter.pdf',
      employeeDeactivatedAt: new Date(),
    };
    db.employeeExitRequest.update.mockResolvedValue(updatedCompleted);

    const req = new NextRequest('http://localhost:3320/api/hr/exit-requests/exit-401/final-approve', {
      method: 'POST',
    });

    const res = await finalApproveExitRequest(req, { params: Promise.resolve({ id: 'exit-401' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('COMPLETED');
    expect(mockPdf.buildRelievingLetterPdf).toHaveBeenCalledTimes(1);
    expect(mockStorage.uploadHrLetter).toHaveBeenCalledWith({
      employeeId: 'emp-1',
      letterType: 'relieving',
      pdfBuffer: expect.any(Buffer),
    });
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 'emp-1' },
      data: { isActive: false, dateOfExit: exitRequest.lastWorkingDate },
    });
  });

  // Scenario 5: Rejection -> terminates as REJECTED, employee remains active, zero final side effects
  it('Scenario 5: Rejection marks request REJECTED, keeps employee active, and executes zero side effects', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockApproverUser);

    const exitRequest = {
      id: 'exit-501',
      employeeId: 'emp-1',
      exitType: 'VOLUNTARY_RESIGNATION',
      status: 'IN_PROGRESS',
      initiatedById: mockUser.userId,
      approvalInstanceId: 'inst-501',
      employee: mockEmployee,
    };
    db.employeeExitRequest.findUnique.mockResolvedValue(exitRequest);

    mockEngine.processStageAction.mockResolvedValue({
      newStatus: 'REJECTED',
      nextStage: null,
    });

    const updatedRejected = {
      ...exitRequest,
      status: 'REJECTED',
      finalHrApprovedById: mockApproverUser.userId,
      finalHrApprovedAt: new Date(),
    };
    db.employeeExitRequest.update.mockResolvedValue(updatedRejected);

    const req = new NextRequest('http://localhost:3320/api/hr/exit-requests/exit-501/reject', {
      method: 'POST',
      body: JSON.stringify({ reviewRemarks: 'Exit request revoked by management' }),
    });

    const res = await rejectExitRequest(req, { params: Promise.resolve({ id: 'exit-501' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('REJECTED');
    expect(mockEngine.processStageAction).toHaveBeenCalledWith(
      {
        instanceId: 'inst-501',
        actorUserId: mockApproverUser.userId,
        action: 'reject',
        remarks: 'Exit request revoked by management',
      },
      mockApproverUser
    );

    // Zero side effects
    expect(mockPdf.buildRelievingLetterPdf).not.toHaveBeenCalled();
    expect(mockStorage.uploadHrLetter).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  // Scenario 6: Non-admin initiator self-approval blocked (400)
  it('Scenario 6: Non-admin initiator cannot self-approve on the engine path (400)', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockUser);

    const exitRequest = {
      id: 'exit-601',
      employeeId: 'emp-1',
      exitType: 'VOLUNTARY_RESIGNATION',
      lastWorkingDate: new Date('2026-10-15'),
      status: 'IN_PROGRESS',
      initiatedById: mockUser.userId, // same as actor
      approvalInstanceId: 'inst-601',
      employee: mockEmployee,
      clearanceItems: mockClearanceItemsCleared,
    };
    db.employeeExitRequest.findUnique.mockResolvedValue(exitRequest);

    mockEngine.processStageAction.mockRejectedValue(new Error('Self-approval is not allowed'));

    const req = new NextRequest('http://localhost:3320/api/hr/exit-requests/exit-601/final-approve', {
      method: 'POST',
    });

    const res = await finalApproveExitRequest(req, { params: Promise.resolve({ id: 'exit-601' }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Self-approval is not allowed');
    expect(mockPdf.buildRelievingLetterPdf).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  // Scenario 7: Admin initiator CAN self-approve on the engine path and finalize
  it('Scenario 7: Admin initiator CAN self-approve on the engine path and finalize', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockAdminUser);

    const exitRequest = {
      id: 'exit-701',
      employeeId: 'emp-1',
      exitType: 'VOLUNTARY_RESIGNATION',
      lastWorkingDate: new Date('2026-10-15'),
      status: 'IN_PROGRESS',
      initiatedById: mockAdminUser.userId, // Admin is submitter
      approvalInstanceId: 'inst-701',
      employee: mockEmployee,
      clearanceItems: mockClearanceItemsCleared,
    };
    db.employeeExitRequest.findUnique.mockResolvedValue(exitRequest);

    mockEngine.processStageAction.mockResolvedValue({
      newStatus: 'APPROVED',
      nextStage: null,
    });

    const updatedCompleted = {
      ...exitRequest,
      status: 'COMPLETED',
      finalHrApprovedById: mockAdminUser.userId,
      finalHrApprovedAt: new Date(),
    };
    db.employeeExitRequest.update.mockResolvedValue(updatedCompleted);

    const req = new NextRequest('http://localhost:3320/api/hr/exit-requests/exit-701/final-approve', {
      method: 'POST',
    });

    const res = await finalApproveExitRequest(req, { params: Promise.resolve({ id: 'exit-701' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('COMPLETED');
    expect(mockPdf.buildRelievingLetterPdf).toHaveBeenCalledTimes(1);
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 'emp-1' },
      data: { isActive: false, dateOfExit: exitRequest.lastWorkingDate },
    });
  });

  // Scenario 8: Legacy Exit record approval (approvalInstanceId = null) runs legacy branch
  it('Scenario 8: Legacy Exit record approval runs legacy path, finalizes exit, and executes side effects', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockApproverUser);

    const legacyExit = {
      id: 'exit-801',
      employeeId: 'emp-1',
      exitType: 'VOLUNTARY_RESIGNATION',
      lastWorkingDate: new Date('2026-10-15'),
      status: 'IN_PROGRESS',
      initiatedById: mockUser.userId,
      approvalInstanceId: null, // Legacy record
      employee: mockEmployee,
      clearanceItems: mockClearanceItemsCleared,
    };
    db.employeeExitRequest.findUnique.mockResolvedValue(legacyExit);

    const updatedCompleted = {
      ...legacyExit,
      status: 'COMPLETED',
      finalHrApprovedById: mockApproverUser.userId,
      finalHrApprovedAt: new Date(),
    };
    db.employeeExitRequest.update.mockResolvedValue(updatedCompleted);

    const req = new NextRequest('http://localhost:3320/api/hr/exit-requests/exit-801/final-approve', {
      method: 'POST',
    });

    const res = await finalApproveExitRequest(req, { params: Promise.resolve({ id: 'exit-801' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('COMPLETED');

    // Engine was NOT called
    expect(mockEngine.processStageAction).not.toHaveBeenCalled();

    // Side effects ran
    expect(mockPdf.buildRelievingLetterPdf).toHaveBeenCalledTimes(1);
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 'emp-1' },
      data: { isActive: false, dateOfExit: legacyExit.lastWorkingDate },
    });
  });

  // Scenario 9: Legacy record does NOT fabricate ApprovalInstance
  it('Scenario 9: Legacy record approval does not fabricate ApprovalInstance or stage history', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockApproverUser);

    const legacyExit = {
      id: 'exit-901',
      employeeId: 'emp-1',
      exitType: 'VOLUNTARY_RESIGNATION',
      lastWorkingDate: new Date('2026-10-15'),
      status: 'IN_PROGRESS',
      initiatedById: mockUser.userId,
      approvalInstanceId: null,
      employee: mockEmployee,
      clearanceItems: mockClearanceItemsCleared,
    };
    db.employeeExitRequest.findUnique.mockResolvedValue(legacyExit);
    db.employeeExitRequest.update.mockResolvedValue({ ...legacyExit, status: 'COMPLETED' });

    const req = new NextRequest('http://localhost:3320/api/hr/exit-requests/exit-901/final-approve', {
      method: 'POST',
    });

    await finalApproveExitRequest(req, { params: Promise.resolve({ id: 'exit-901' }) });

    expect(mockEngine.startApprovalWorkflow).not.toHaveBeenCalled();
    expect(mockEngine.processStageAction).not.toHaveBeenCalled();
    expect(db.approvalInstance.create).not.toHaveBeenCalled();
  });

  // Scenario 10: Skip-approval -> final Exit side effects execute immediately on submission
  it('Scenario 10: Skip-approval workflow path creates record and executes side effects immediately upon submission', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockUser);
    db.user.findUnique.mockResolvedValue(mockEmployee);
    db.employeeExitRequest.findFirst.mockResolvedValue(null);
    db.exitClearanceItemConfig.findMany.mockResolvedValue([]);

    const createdRecord = {
      id: 'exit-1001',
      employeeId: 'emp-1',
      exitType: 'VOLUNTARY_RESIGNATION',
      requestedDate: new Date('2026-10-01'),
      lastWorkingDate: new Date('2026-10-15'),
      status: 'IN_PROGRESS',
      initiatedById: mockUser.userId,
      approvalInstanceId: null,
      clearanceItems: [],
    };
    db.employeeExitRequest.create.mockResolvedValue(createdRecord);

    mockEngine.startApprovalWorkflow.mockResolvedValue({
      instanceId: 'inst-auto',
      workflowName: 'Auto Approved Exit',
    });
    // Instance status is APPROVED -> triggers skip approval
    db.approvalInstance.findUnique.mockResolvedValue({ id: 'inst-auto', status: 'APPROVED' });

    const finalizedCompleted = {
      ...createdRecord,
      status: 'COMPLETED',
      approvalInstanceId: 'inst-auto',
      employee: { id: 'emp-1', firstName: 'John', lastName: 'Doe', employeeId: 'EMP-001' },
      clearanceItems: [],
    };
    db.employeeExitRequest.update.mockResolvedValue(finalizedCompleted);

    const req = new NextRequest('http://localhost:3320/api/hr/exit-requests', {
      method: 'POST',
      body: JSON.stringify({
        employeeId: 'emp-1',
        exitType: 'VOLUNTARY_RESIGNATION',
        requestedDate: '2026-10-01',
        lastWorkingDate: '2026-10-15',
        reason: 'Immediate CEO Separation',
      }),
    });

    const res = await createExitRequest(req);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('COMPLETED');
    expect(json.data.approvalInstanceId).toBe('inst-auto');

    // Side effects ran immediately
    expect(mockPdf.buildRelievingLetterPdf).toHaveBeenCalledTimes(1);
    expect(mockStorage.uploadHrLetter).toHaveBeenCalledWith({
      employeeId: 'emp-1',
      letterType: 'relieving',
      pdfBuffer: expect.any(Buffer),
    });
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 'emp-1' },
      data: { isActive: false, dateOfExit: expect.any(Date) },
    });
  });

  // Scenario 11: Clearance validation -> incomplete clearance blocks final approval (409)
  it('Scenario 11: Incomplete clearance blocks final approval (409) and prevents employee deactivation', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockAdminUser);

    const exitRequest = {
      id: 'exit-1101',
      employeeId: 'emp-1',
      exitType: 'VOLUNTARY_RESIGNATION',
      lastWorkingDate: new Date('2026-10-15'),
      status: 'IN_PROGRESS',
      initiatedById: mockUser.userId,
      approvalInstanceId: 'inst-1101',
      employee: mockEmployee,
      clearanceItems: mockClearanceItemsPending, // Contains PENDING item
    };
    db.employeeExitRequest.findUnique.mockResolvedValue(exitRequest);

    const req = new NextRequest('http://localhost:3320/api/hr/exit-requests/exit-1101/final-approve', {
      method: 'POST',
    });

    const res = await finalApproveExitRequest(req, { params: Promise.resolve({ id: 'exit-1101' }) });
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.success).toBe(false);
    expect(json.error).toContain('clearance item(s) are not yet cleared');

    // Generic engine was NOT called, no deactivation
    expect(mockEngine.processStageAction).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
    expect(mockPdf.buildRelievingLetterPdf).not.toHaveBeenCalled();
  });

  // Scenario 12: GET / list / detail behavior -> UI data and pending approval descriptions preserved
  it('Scenario 12: GET list and detail preserve existing UI data and approval info', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockUser);

    const mockList = [
      {
        id: 'exit-1',
        status: 'IN_PROGRESS',
        employee: { branchId: 'branch-1' },
        clearanceItems: [],
      },
    ];
    db.employeeExitRequest.findMany.mockResolvedValue(mockList);

    const approvalMap = new Map();
    approvalMap.set('exit-1', {
      stageName: 'Admin Approval',
      stageNumber: 1,
      totalStages: 1,
      approverRoleSlug: 'admin',
      canAct: true,
    });
    mockRecordApproval.describePendingApprovals.mockResolvedValue(approvalMap);

    // List GET
    const listReq = new NextRequest('http://localhost:3320/api/hr/exit-requests');
    const listRes = await getExitRequests(listReq);
    const listJson = await listRes.json();

    expect(listRes.status).toBe(200);
    expect(listJson.success).toBe(true);
    expect(listJson.data[0].approval).toEqual({
      stageName: 'Admin Approval',
      stageNumber: 1,
      totalStages: 1,
      approverRoleSlug: 'admin',
      canAct: true,
    });

    // Detail GET
    const singleRecord = {
      id: 'exit-1',
      status: 'IN_PROGRESS',
      employee: { branchId: 'branch-1' },
      clearanceItems: [],
    };
    db.employeeExitRequest.findUnique.mockResolvedValue(singleRecord);

    const detailReq = new NextRequest('http://localhost:3320/api/hr/exit-requests/exit-1');
    const detailRes = await getExitRequestDetail(detailReq, { params: Promise.resolve({ id: 'exit-1' }) });
    const detailJson = await detailRes.json();

    expect(detailRes.status).toBe(200);
    expect(detailJson.success).toBe(true);
    expect(detailJson.data.approval).toEqual({
      stageName: 'Admin Approval',
      stageNumber: 1,
      totalStages: 1,
      approverRoleSlug: 'admin',
      canAct: true,
    });
  });
});

