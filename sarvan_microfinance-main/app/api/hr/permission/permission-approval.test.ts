import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { UserContext } from '@/app/lib/permissions/types';

// Mock DB and external services
const db = vi.hoisted(() => {
  const permissionRequest = {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  const permissionType = {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
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
    updateMany: vi.fn(),
  };
  const approvalLog = {
    create: vi.fn(),
  };
  const tx = {
    permissionRequest,
    permissionType,
    user,
    approvalInstance,
    approvalLog,
  };
  return {
    permissionRequest,
    permissionType,
    user,
    approvalInstance,
    approvalLog,
    tx,
    prisma: {
      ...tx,
      $transaction: vi.fn(async (arg: unknown) => {
        if (typeof arg === 'function') return (arg as (txClient: typeof tx) => Promise<unknown>)(tx);
        if (Array.isArray(arg)) return Promise.all(arg);
        return arg;
      }),
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
  canActorApplyForEmployee: vi.fn(),
  requireEmployeeAccess: vi.fn(),
  getUserContext: vi.fn(),
}));

vi.mock('@/app/lib/permissions/guards', () => ({
  requirePermission: mockPermissions.requirePermission,
  isUserContext: mockPermissions.isUserContext,
  isEmployeeBranchPermitted: mockPermissions.isEmployeeBranchPermitted,
  // Routes now call the async org-scope-aware variant; the tests drive both through the same mock.
  isEmployeeInCallerScope: async (...args: unknown[]) => (mockPermissions.isEmployeeBranchPermitted as (...a: unknown[]) => unknown)(...args),
  canActorApplyForEmployee: mockPermissions.canActorApplyForEmployee,
  requireEmployeeAccess: mockPermissions.requireEmployeeAccess,
  getUserContext: mockPermissions.getUserContext,
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
  cancelRecordApproval: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/app/lib/approval/record-approval', () => ({
  describePendingApprovals: mockRecordApproval.describePendingApprovals,
  cancelRecordApproval: mockRecordApproval.cancelRecordApproval,
}));

// Mock withAuth to pass through with authenticated user
vi.mock('@/app/lib/api-utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/lib/api-utils')>();
  return {
    ...actual,
    withAuth: (handler: (req: NextRequest, user: { userId: string; email: string }) => Promise<unknown>) => {
      return async (req: NextRequest) => {
        const userId = req.headers.get('x-user-id') || 'user-submitter';
        return handler(req, { userId, email: `${userId}@example.com` });
      };
    },
  };
});

import { POST as applyPermission } from './apply/route';
import { GET as getPermissions } from './route';
import { POST as approvePermission } from './[id]/approve/route';
import { POST as rejectPermission } from './[id]/reject/route';
import { POST as cancelPermission } from './[id]/cancel/route';

describe('HR Permission Approval Engine Migration', () => {
  const createMockUserContext = (overrides: Partial<UserContext> = {}): UserContext => ({
    userId: 'user-submitter',
    email: 'submitter@example.com',
    firstName: 'Submitter',
    lastName: 'User',
    isActive: true,
    branchId: 'branch-1',
    isHeadOffice: false,
    roles: [{ roleId: 'r1', roleName: 'Staff', roleSlug: 'staff', priority: 5, branchId: null }],
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
    id: 'user-submitter',
    firstName: 'Submitter',
    lastName: 'User',
    employeeId: 'EMP-100',
    branchId: 'branch-1',
  };

  const mockPermissionType = {
    id: 'pt-personal',
    permissionType: 'Personal Work',
    isActive: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPermissions.isEmployeeBranchPermitted.mockReturnValue(true);
  });

  // Scenario 1: Standard Permission creation -> approvalInstanceId stored
  it('Scenario 1: Standard Permission creation creates PENDING record, starts workflow, and stores approvalInstanceId', async () => {
    db.permissionType.findFirst.mockResolvedValue(mockPermissionType);
    db.permissionRequest.findMany.mockResolvedValue([]);

    const createdReq = {
      id: 'perm-101',
      employeeId: mockUser.userId,
      permissionTypeId: 'pt-personal',
      date: new Date('2026-10-01T00:00:00.000Z'),
      fromTime: '10:00',
      toTime: '12:00',
      hours: 2,
      status: 'PENDING',
      approvalInstanceId: null,
      employee: mockEmployee,
    };
    db.permissionRequest.create.mockResolvedValue(createdReq);

    mockEngine.startApprovalWorkflow.mockResolvedValue({
      instanceId: 'inst-perm-101',
      workflowName: 'Admin-Only Permission Approval',
    });
    db.approvalInstance.findUnique.mockResolvedValue({ id: 'inst-perm-101', status: 'PENDING' });

    const updatedPending = {
      ...createdReq,
      approvalInstanceId: 'inst-perm-101',
    };
    db.permissionRequest.update.mockResolvedValue(updatedPending);

    const req = new NextRequest('http://localhost:3320/api/hr/permission/apply', {
      method: 'POST',
      headers: { 'x-user-id': mockUser.userId },
      body: JSON.stringify({
        permissionTypeId: 'pt-personal',
        date: '2026-10-01',
        fromTime: '10:00',
        toTime: '12:00',
        reason: 'Bank visit',
      }),
    });

    const res = await applyPermission(req);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.data.approvalInstanceId).toBe('inst-perm-101');
    expect(json.data.status).toBe('PENDING');
    expect(mockEngine.startApprovalWorkflow).toHaveBeenCalledWith({
      moduleSlug: 'hr-permission',
      recordType: 'PermissionRequest',
      recordId: 'perm-101',
      branchId: 'branch-1',
      submittedByUserId: mockUser.userId,
    });
  });

  // Scenario 2: Standard engine-backed Permission -> remains pending
  it('Scenario 2: Standard engine-backed Permission remains PENDING upon submission with no early side effects', async () => {
    db.permissionType.findFirst.mockResolvedValue(mockPermissionType);
    db.permissionRequest.findMany.mockResolvedValue([]);

    const createdReq = {
      id: 'perm-102',
      employeeId: mockUser.userId,
      permissionTypeId: 'pt-personal',
      date: new Date('2026-10-01'),
      fromTime: '14:00',
      toTime: '16:00',
      hours: 2,
      status: 'PENDING',
      employee: mockEmployee,
    };
    db.permissionRequest.create.mockResolvedValue(createdReq);
    mockEngine.startApprovalWorkflow.mockResolvedValue({ instanceId: 'inst-perm-102' });
    db.approvalInstance.findUnique.mockResolvedValue({ id: 'inst-perm-102', status: 'PENDING' });
    db.permissionRequest.update.mockResolvedValue({ ...createdReq, approvalInstanceId: 'inst-perm-102' });

    const req = new NextRequest('http://localhost:3320/api/hr/permission/apply', {
      method: 'POST',
      headers: { 'x-user-id': mockUser.userId },
      body: JSON.stringify({
        permissionTypeId: 'pt-personal',
        date: '2026-10-01',
        fromTime: '14:00',
        toTime: '16:00',
      }),
    });

    const res = await applyPermission(req);
    expect(res.status).toBe(201);
    expect(db.permissionRequest.update).toHaveBeenCalledWith({
      where: { id: 'perm-102' },
      data: { approvalInstanceId: 'inst-perm-102' },
      include: expect.any(Object),
    });
  });

  // Scenario 3: Intermediate approval -> approval stage advances, permission remains pending, no final side effects
  it('Scenario 3: Intermediate approval advances stage, leaves application PENDING, and executes zero final side effects', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockApproverUser);

    const permission = {
      id: 'perm-301',
      employeeId: mockUser.userId,
      permissionTypeId: 'pt-personal',
      date: new Date('2026-10-01'),
      status: 'PENDING',
      approvalInstanceId: 'inst-multi',
      employee: mockEmployee,
    };
    db.permissionRequest.findUnique.mockResolvedValue(permission);

    mockEngine.processStageAction.mockResolvedValue({
      newStatus: 'IN_PROGRESS',
      nextStage: 'HR Head Approval',
    });

    const req = new NextRequest('http://localhost:3320/api/hr/permission/perm-301/approve', {
      method: 'POST',
    });

    const res = await approvePermission(req, { params: Promise.resolve({ id: 'perm-301' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.message).toContain('Approved at this level — now awaiting HR Head Approval');
    expect(json.data.status).toBe('PENDING');

    // Terminal update is NOT called
    expect(db.permissionRequest.update).not.toHaveBeenCalled();
  });

  // Scenario 4: Final approval -> Permission becomes approved, final effects execute exactly once
  it('Scenario 4: Final approval terminates as APPROVED and records approver metadata', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockApproverUser);

    const permission = {
      id: 'perm-401',
      employeeId: mockUser.userId,
      permissionTypeId: 'pt-personal',
      status: 'PENDING',
      approvalInstanceId: 'inst-401',
      employee: mockEmployee,
    };
    db.permissionRequest.findUnique.mockResolvedValue(permission);

    mockEngine.processStageAction.mockResolvedValue({
      newStatus: 'APPROVED',
      nextStage: null,
    });

    const updatedApproved = {
      ...permission,
      status: 'APPROVED',
      approvedById: mockApproverUser.userId,
      approvedAt: new Date(),
    };
    db.permissionRequest.update.mockResolvedValue(updatedApproved);

    const req = new NextRequest('http://localhost:3320/api/hr/permission/perm-401/approve', {
      method: 'POST',
    });

    const res = await approvePermission(req, { params: Promise.resolve({ id: 'perm-401' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('APPROVED');
    expect(db.permissionRequest.update).toHaveBeenCalledWith({
      where: { id: 'perm-401' },
      data: { status: 'APPROVED', approvedById: mockApproverUser.userId, approvedAt: expect.any(Date) },
    });
  });

  // Scenario 5: Rejection -> Permission becomes rejected, no final side effects
  it('Scenario 5: Rejection terminates permission as REJECTED with zero approval side effects', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockApproverUser);

    const permission = {
      id: 'perm-501',
      employeeId: mockUser.userId,
      permissionTypeId: 'pt-personal',
      status: 'PENDING',
      approvalInstanceId: 'inst-501',
      employee: mockEmployee,
    };
    db.permissionRequest.findUnique.mockResolvedValue(permission);

    mockEngine.processStageAction.mockResolvedValue({
      newStatus: 'REJECTED',
      nextStage: null,
    });

    const updatedRejected = {
      ...permission,
      status: 'REJECTED',
      approvedById: mockApproverUser.userId,
      approvedAt: new Date(),
      approvalRemarks: 'Shift clash with high client volume',
    };
    db.permissionRequest.update.mockResolvedValue(updatedRejected);

    const req = new NextRequest('http://localhost:3320/api/hr/permission/perm-501/reject', {
      method: 'POST',
      body: JSON.stringify({ approvalRemarks: 'Shift clash with high client volume' }),
    });

    const res = await rejectPermission(req, { params: Promise.resolve({ id: 'perm-501' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('REJECTED');
    expect(mockEngine.processStageAction).toHaveBeenCalledWith(
      {
        instanceId: 'inst-501',
        actorUserId: mockApproverUser.userId,
        action: 'reject',
        remarks: 'Shift clash with high client volume',
      },
      mockApproverUser
    );
  });

  // Scenario 6: Non-admin initiator self-approval blocked (HTTP 400)
  it('Scenario 6: Non-admin initiator self-approval is blocked with HTTP 400', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockUser);

    const permission = {
      id: 'perm-601',
      employeeId: mockUser.userId, // same as actor
      permissionTypeId: 'pt-personal',
      status: 'PENDING',
      approvalInstanceId: 'inst-601',
      employee: mockEmployee,
    };
    db.permissionRequest.findUnique.mockResolvedValue(permission);

    mockEngine.processStageAction.mockRejectedValue(new Error('Self-approval is not allowed'));

    const req = new NextRequest('http://localhost:3320/api/hr/permission/perm-601/approve', {
      method: 'POST',
    });

    const res = await approvePermission(req, { params: Promise.resolve({ id: 'perm-601' }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Self-approval is not allowed');
    expect(db.permissionRequest.update).not.toHaveBeenCalled();
  });

  // Scenario 7: Admin initiator self-approval succeeds
  it('Scenario 7: Admin initiator CAN self-approve on the engine path and finalize', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockAdminUser);

    const permission = {
      id: 'perm-701',
      employeeId: mockAdminUser.userId, // Admin is applicant
      permissionTypeId: 'pt-personal',
      status: 'PENDING',
      approvalInstanceId: 'inst-701',
      employee: { ...mockEmployee, id: mockAdminUser.userId },
    };
    db.permissionRequest.findUnique.mockResolvedValue(permission);

    mockEngine.processStageAction.mockResolvedValue({
      newStatus: 'APPROVED',
      nextStage: null,
    });

    const updatedApproved = {
      ...permission,
      status: 'APPROVED',
      approvedById: mockAdminUser.userId,
      approvedAt: new Date(),
    };
    db.permissionRequest.update.mockResolvedValue(updatedApproved);

    const req = new NextRequest('http://localhost:3320/api/hr/permission/perm-701/approve', {
      method: 'POST',
    });

    const res = await approvePermission(req, { params: Promise.resolve({ id: 'perm-701' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('APPROVED');
  });

  // Scenario 8: Legacy Permission record: approvalInstanceId = null -> uses legacy path
  it('Scenario 8: Legacy Permission record approval runs legacy branch and finalizes permission', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockApproverUser);

    const legacyPermission = {
      id: 'perm-801',
      employeeId: mockUser.userId,
      permissionTypeId: 'pt-personal',
      status: 'PENDING',
      approvalInstanceId: null, // Legacy record
      employee: mockEmployee,
    };
    db.permissionRequest.findUnique.mockResolvedValue(legacyPermission);

    const updatedApproved = {
      ...legacyPermission,
      status: 'APPROVED',
      approvedById: mockApproverUser.userId,
      approvedAt: new Date(),
    };
    db.permissionRequest.update.mockResolvedValue(updatedApproved);

    const req = new NextRequest('http://localhost:3320/api/hr/permission/perm-801/approve', {
      method: 'POST',
    });

    const res = await approvePermission(req, { params: Promise.resolve({ id: 'perm-801' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('APPROVED');

    // Generic engine is NOT called
    expect(mockEngine.processStageAction).not.toHaveBeenCalled();
  });

  // Scenario 9: Legacy Permission record -> no ApprovalInstance fabricated
  it('Scenario 9: Legacy record approval does not fabricate ApprovalInstance or stage history', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockApproverUser);

    const legacyPermission = {
      id: 'perm-901',
      employeeId: mockUser.userId,
      permissionTypeId: 'pt-personal',
      status: 'PENDING',
      approvalInstanceId: null,
      employee: mockEmployee,
    };
    db.permissionRequest.findUnique.mockResolvedValue(legacyPermission);
    db.permissionRequest.update.mockResolvedValue({ ...legacyPermission, status: 'APPROVED' });

    const req = new NextRequest('http://localhost:3320/api/hr/permission/perm-901/approve', {
      method: 'POST',
    });

    await approvePermission(req, { params: Promise.resolve({ id: 'perm-901' }) });

    expect(mockEngine.startApprovalWorkflow).not.toHaveBeenCalled();
    expect(mockEngine.processStageAction).not.toHaveBeenCalled();
    expect(db.approvalInstance.create).not.toHaveBeenCalled();
  });

  // Scenario 10: Skip-approval workflow -> final Permission effects execute immediately
  it('Scenario 10: Skip-approval workflow path creates record and executes approval immediately on submission', async () => {
    db.permissionType.findFirst.mockResolvedValue(mockPermissionType);
    db.permissionRequest.findMany.mockResolvedValue([]);

    const createdReq = {
      id: 'perm-1001',
      employeeId: mockUser.userId,
      permissionTypeId: 'pt-personal',
      date: new Date('2026-10-01'),
      fromTime: '10:00',
      toTime: '12:00',
      hours: 2,
      status: 'PENDING',
      approvalInstanceId: null,
      employee: mockEmployee,
    };
    db.permissionRequest.create.mockResolvedValue(createdReq);

    mockEngine.startApprovalWorkflow.mockResolvedValue({
      instanceId: 'inst-auto',
      workflowName: 'Auto Approved Permission',
    });
    db.approvalInstance.findUnique.mockResolvedValue({ id: 'inst-auto', status: 'APPROVED' });

    const finalizedApproved = {
      ...createdReq,
      status: 'APPROVED',
      approvalInstanceId: 'inst-auto',
    };
    db.permissionRequest.update.mockResolvedValue(finalizedApproved);

    const req = new NextRequest('http://localhost:3320/api/hr/permission/apply', {
      method: 'POST',
      headers: { 'x-user-id': mockUser.userId },
      body: JSON.stringify({
        permissionTypeId: 'pt-personal',
        date: '2026-10-01',
        fromTime: '10:00',
        toTime: '12:00',
      }),
    });

    const res = await applyPermission(req);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('APPROVED');
    expect(json.data.approvalInstanceId).toBe('inst-auto');
  });

  // Scenario 11: Attendance safety -> intermediate approval does not mutate final attendance state
  it('Scenario 11: Attendance safety: intermediate approval does not mark attendance', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockApproverUser);

    const permission = {
      id: 'perm-1101',
      employeeId: mockUser.userId,
      permissionTypeId: 'pt-personal',
      status: 'PENDING',
      approvalInstanceId: 'inst-1101',
      employee: mockEmployee,
    };
    db.permissionRequest.findUnique.mockResolvedValue(permission);

    mockEngine.processStageAction.mockResolvedValue({
      newStatus: 'IN_PROGRESS',
      nextStage: 'Director Approval',
    });

    const req = new NextRequest('http://localhost:3320/api/hr/permission/perm-1101/approve', {
      method: 'POST',
    });

    await approvePermission(req, { params: Promise.resolve({ id: 'perm-1101' }) });

    // Status remains PENDING and no updates
    expect(db.permissionRequest.update).not.toHaveBeenCalled();
  });

  // Scenario 12: Existing validation behavior -> invalid times or overlapping requests rejected
  it('Scenario 12: Invalid times (to <= from) return 400 validation error', async () => {
    const req = new NextRequest('http://localhost:3320/api/hr/permission/apply', {
      method: 'POST',
      headers: { 'x-user-id': mockUser.userId },
      body: JSON.stringify({
        permissionTypeId: 'pt-personal',
        date: '2026-10-01',
        fromTime: '12:00',
        toTime: '10:00', // Invalid: toTime before fromTime
      }),
    });

    const res = await applyPermission(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toBe('To time must be after from time');
    expect(db.permissionRequest.create).not.toHaveBeenCalled();
  });

  // Scenario 13: Existing cancellation/withdrawal behavior -> remains intact
  it('Scenario 13: Cancel pending permission sets CANCELLED and cancels record approval', async () => {
    const permission = {
      id: 'perm-1301',
      employeeId: mockUser.userId,
      status: 'PENDING',
    };
    db.permissionRequest.findUnique.mockResolvedValue(permission);
    db.permissionRequest.update.mockResolvedValue({ ...permission, status: 'CANCELLED' });

    const req = new NextRequest('http://localhost:3320/api/hr/permission/perm-1301/cancel', {
      method: 'POST',
      headers: { 'x-user-id': mockUser.userId },
    });

    const res = await cancelPermission(req, { params: Promise.resolve({ id: 'perm-1301' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('CANCELLED');
    expect(mockRecordApproval.cancelRecordApproval).toHaveBeenCalledWith('PermissionRequest', 'perm-1301', mockUser.userId);
  });

  // Scenario 14: GET / list / detail behavior -> existing UI data remains intact
  it('Scenario 14: GET /api/hr/permission preserves UI data and approval details', async () => {
    const mockList = [
      {
        id: 'perm-1',
        employeeId: mockUser.userId,
        permissionTypeId: 'pt-personal',
        date: new Date('2026-10-01'),
        fromTime: '10:00',
        toTime: '12:00',
        hours: 2,
        status: 'PENDING',
        employee: { branchId: 'branch-1' },
      },
    ];
    db.permissionRequest.findMany.mockResolvedValue(mockList);

    const approvalMap = new Map();
    approvalMap.set('perm-1', {
      stageName: 'Branch Manager Approval',
      stageNumber: 1,
      totalStages: 1,
      approverRoleSlug: 'branch-manager',
      canAct: true,
    });
    mockRecordApproval.describePendingApprovals.mockResolvedValue(approvalMap);
    mockPermissions.getUserContext.mockResolvedValue(mockUser);

    const req = new NextRequest('http://localhost:3320/api/hr/permission');
    const res = await getPermissions(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data[0].approval).toEqual({
      stageName: 'Branch Manager Approval',
      stageNumber: 1,
      totalStages: 1,
      approverRoleSlug: 'branch-manager',
      canAct: true,
    });
  });
});

