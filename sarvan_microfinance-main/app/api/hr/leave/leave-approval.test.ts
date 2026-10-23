import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { UserContext } from '@/app/lib/permissions/types';

// Mock DB and external services
const db = vi.hoisted(() => {
  const leaveApplication = {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  const leaveType = {
    findUnique: vi.fn(),
  };
  const user = {
    findUnique: vi.fn(),
    update: vi.fn(),
  };
  const attendance = {
    findUnique: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    findMany: vi.fn(),
  };
  const employeeLeaveBalance = {
    upsert: vi.fn(),
    findUnique: vi.fn(),
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
    leaveApplication,
    leaveType,
    user,
    attendance,
    employeeLeaveBalance,
    approvalInstance,
    approvalLog,
  };
  return {
    leaveApplication,
    leaveType,
    user,
    attendance,
    employeeLeaveBalance,
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

const mockAttendanceLeave = vi.hoisted(() => ({
  getRemainingLeaveBalance: vi.fn().mockResolvedValue(5),
  resolveLopLeaveType: vi.fn().mockResolvedValue({ id: 'lt-lop', leaveType: 'Loss of Pay' }),
  getRemainingLeaveBalancesBatch: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock('@/app/lib/attendance-leave-permission', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/lib/attendance-leave-permission')>();
  return {
    ...actual,
    getRemainingLeaveBalance: mockAttendanceLeave.getRemainingLeaveBalance,
    resolveLopLeaveType: mockAttendanceLeave.resolveLopLeaveType,
    getRemainingLeaveBalancesBatch: mockAttendanceLeave.getRemainingLeaveBalancesBatch,
  };
});

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

import { POST as applyLeave } from './apply/route';
import { GET as getLeaves } from './route';
import { POST as approveLeave } from './[id]/approve/route';
import { POST as rejectLeave } from './[id]/reject/route';
import { POST as cancelLeave } from './[id]/cancel/route';

describe('HR Leave Approval Engine Migration', () => {
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

  const mockLeaveType = {
    id: 'lt-casual',
    leaveType: 'Casual Leave',
    isActive: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPermissions.isEmployeeBranchPermitted.mockReturnValue(true);
    mockAttendanceLeave.getRemainingLeaveBalance.mockResolvedValue(5);
  });

  // Scenario 1: Standard Leave creation -> approvalInstanceId stored
  it('Scenario 1: Standard Leave creation creates PENDING record, starts workflow, and stores approvalInstanceId', async () => {
    db.leaveType.findUnique.mockResolvedValue(mockLeaveType);
    db.leaveApplication.findFirst.mockResolvedValue(null);

    const createdApp = {
      id: 'leave-101',
      employeeId: mockUser.userId,
      leaveTypeId: 'lt-casual',
      fromDate: new Date('2026-10-01'),
      toDate: new Date('2026-10-02'),
      numberOfDays: 2,
      status: 'PENDING',
      approvalInstanceId: null,
      employee: mockEmployee,
    };
    db.leaveApplication.create.mockResolvedValue(createdApp);

    mockEngine.startApprovalWorkflow.mockResolvedValue({
      instanceId: 'inst-leave-101',
      workflowName: 'Admin-Only Leave Approval',
    });
    db.approvalInstance.findUnique.mockResolvedValue({ id: 'inst-leave-101', status: 'PENDING' });

    const updatedPending = {
      ...createdApp,
      approvalInstanceId: 'inst-leave-101',
    };
    db.leaveApplication.update.mockResolvedValue(updatedPending);

    const req = new NextRequest('http://localhost:3320/api/hr/leave/apply', {
      method: 'POST',
      headers: { 'x-user-id': mockUser.userId },
      body: JSON.stringify({
        leaveTypeId: 'lt-casual',
        fromDate: '2026-10-01',
        toDate: '2026-10-02',
        reason: 'Family event',
      }),
    });

    const res = await applyLeave(req);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.data.approvalInstanceId).toBe('inst-leave-101');
    expect(json.data.status).toBe('PENDING');
    expect(mockEngine.startApprovalWorkflow).toHaveBeenCalledWith({
      moduleSlug: 'hr-leave',
      recordType: 'LeaveApplication',
      recordId: 'leave-101',
      branchId: 'branch-1',
      submittedByUserId: mockUser.userId,
    });
  });

  // Scenario 2: Standard engine-backed Leave -> remains pending (no side effects on submission)
  it('Scenario 2: Standard engine-backed Leave remains pending with no attendance mutation or balance deduction', async () => {
    db.leaveType.findUnique.mockResolvedValue(mockLeaveType);
    db.leaveApplication.findFirst.mockResolvedValue(null);

    const createdApp = {
      id: 'leave-102',
      employeeId: mockUser.userId,
      leaveTypeId: 'lt-casual',
      fromDate: new Date('2026-10-01'),
      toDate: new Date('2026-10-02'),
      numberOfDays: 2,
      status: 'PENDING',
      employee: mockEmployee,
    };
    db.leaveApplication.create.mockResolvedValue(createdApp);
    mockEngine.startApprovalWorkflow.mockResolvedValue({ instanceId: 'inst-leave-102' });
    db.approvalInstance.findUnique.mockResolvedValue({ id: 'inst-leave-102', status: 'PENDING' });
    db.leaveApplication.update.mockResolvedValue({ ...createdApp, approvalInstanceId: 'inst-leave-102' });

    const req = new NextRequest('http://localhost:3320/api/hr/leave/apply', {
      method: 'POST',
      headers: { 'x-user-id': mockUser.userId },
      body: JSON.stringify({
        leaveTypeId: 'lt-casual',
        fromDate: '2026-10-01',
        toDate: '2026-10-02',
      }),
    });

    const res = await applyLeave(req);
    expect(res.status).toBe(201);

    // No attendance or balance mutation on apply
    expect(db.attendance.upsert).not.toHaveBeenCalled();
    expect(db.employeeLeaveBalance.upsert).not.toHaveBeenCalled();
  });

  // Scenario 3: Intermediate approval -> approval stage advances, leave remains pending, no final side effects
  it('Scenario 3: Intermediate approval advances stage, leaves application PENDING, and executes zero final side effects', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockApproverUser);

    const application = {
      id: 'leave-301',
      employeeId: mockUser.userId,
      leaveTypeId: 'lt-casual',
      fromDate: new Date('2026-10-01'),
      toDate: new Date('2026-10-02'),
      numberOfDays: 2,
      isHalfDay: false,
      status: 'PENDING',
      approvalInstanceId: 'inst-multi',
      employee: mockEmployee,
    };
    db.leaveApplication.findUnique.mockResolvedValue(application);

    mockEngine.processStageAction.mockResolvedValue({
      newStatus: 'IN_PROGRESS',
      nextStage: 'HR Head Approval',
    });

    const req = new NextRequest('http://localhost:3320/api/hr/leave/leave-301/approve', {
      method: 'POST',
    });

    const res = await approveLeave(req, { params: Promise.resolve({ id: 'leave-301' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.message).toContain('Approved at this level — now awaiting HR Head Approval');
    expect(json.data.status).toBe('PENDING');

    // No attendance upserts or balance deductions
    expect(db.attendance.upsert).not.toHaveBeenCalled();
    expect(db.employeeLeaveBalance.upsert).not.toHaveBeenCalled();
  });

  // Scenario 4: Final approval -> Leave becomes approved, balance deducted, attendance stamped exactly once
  it('Scenario 4: Final approval terminates as APPROVED, updates attendance, and deducts leave balance', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockApproverUser);

    const application = {
      id: 'leave-401',
      employeeId: mockUser.userId,
      leaveTypeId: 'lt-casual',
      fromDate: new Date('2026-10-01'),
      toDate: new Date('2026-10-02'),
      numberOfDays: 2,
      isHalfDay: false,
      status: 'PENDING',
      approvalInstanceId: 'inst-401',
      employee: mockEmployee,
    };
    db.leaveApplication.findUnique.mockResolvedValue(application);

    mockEngine.processStageAction.mockResolvedValue({
      newStatus: 'APPROVED',
      nextStage: null,
    });

    const updatedApproved = {
      ...application,
      status: 'APPROVED',
      approvedById: mockApproverUser.userId,
      approvedAt: new Date(),
    };
    db.leaveApplication.update.mockResolvedValue(updatedApproved);

    const req = new NextRequest('http://localhost:3320/api/hr/leave/leave-401/approve', {
      method: 'POST',
    });

    const res = await approveLeave(req, { params: Promise.resolve({ id: 'leave-401' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('APPROVED');
    expect(db.attendance.upsert).toHaveBeenCalledTimes(2); // 2 days in range
    expect(db.employeeLeaveBalance.upsert).toHaveBeenCalledTimes(1);
    expect(db.leaveApplication.update).toHaveBeenCalledWith({
      where: { id: 'leave-401' },
      data: { status: 'APPROVED', approvedById: mockApproverUser.userId, approvedAt: expect.any(Date) },
    });
  });

  // Scenario 5: Rejection -> Leave becomes rejected, no final approval side effects
  it('Scenario 5: Rejection terminates application as REJECTED with zero balance or attendance side effects', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockApproverUser);

    const application = {
      id: 'leave-501',
      employeeId: mockUser.userId,
      leaveTypeId: 'lt-casual',
      status: 'PENDING',
      approvalInstanceId: 'inst-501',
      employee: mockEmployee,
    };
    db.leaveApplication.findUnique.mockResolvedValue(application);

    mockEngine.processStageAction.mockResolvedValue({
      newStatus: 'REJECTED',
      nextStage: null,
    });

    const updatedRejected = {
      ...application,
      status: 'REJECTED',
      approvedById: mockApproverUser.userId,
      approvedAt: new Date(),
      approvalRemarks: 'High operational workload',
    };
    db.leaveApplication.update.mockResolvedValue(updatedRejected);

    const req = new NextRequest('http://localhost:3320/api/hr/leave/leave-501/reject', {
      method: 'POST',
      body: JSON.stringify({ approvalRemarks: 'High operational workload' }),
    });

    const res = await rejectLeave(req, { params: Promise.resolve({ id: 'leave-501' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('REJECTED');
    expect(mockEngine.processStageAction).toHaveBeenCalledWith(
      {
        instanceId: 'inst-501',
        actorUserId: mockApproverUser.userId,
        action: 'reject',
        remarks: 'High operational workload',
      },
      mockApproverUser
    );

    // Zero side effects
    expect(db.attendance.upsert).not.toHaveBeenCalled();
    expect(db.employeeLeaveBalance.upsert).not.toHaveBeenCalled();
  });

  // Scenario 6: Non-admin initiator self-approval blocked (HTTP 400)
  it('Scenario 6: Non-admin initiator self-approval is blocked with 400', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockUser);

    const application = {
      id: 'leave-601',
      employeeId: mockUser.userId, // same as actor
      leaveTypeId: 'lt-casual',
      fromDate: new Date('2026-10-01'),
      toDate: new Date('2026-10-02'),
      status: 'PENDING',
      approvalInstanceId: 'inst-601',
      employee: mockEmployee,
    };
    db.leaveApplication.findUnique.mockResolvedValue(application);

    mockEngine.processStageAction.mockRejectedValue(new Error('Self-approval is not allowed'));

    const req = new NextRequest('http://localhost:3320/api/hr/leave/leave-601/approve', {
      method: 'POST',
    });

    const res = await approveLeave(req, { params: Promise.resolve({ id: 'leave-601' }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Self-approval is not allowed');
    expect(db.attendance.upsert).not.toHaveBeenCalled();
  });

  // Scenario 7: Admin initiator self-approval succeeds
  it('Scenario 7: Admin initiator CAN self-approve on the engine path and finalize', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockAdminUser);

    const application = {
      id: 'leave-701',
      employeeId: mockAdminUser.userId, // Admin is the applicant
      leaveTypeId: 'lt-casual',
      fromDate: new Date('2026-10-01'),
      toDate: new Date('2026-10-01'),
      numberOfDays: 1,
      isHalfDay: false,
      status: 'PENDING',
      approvalInstanceId: 'inst-701',
      employee: { ...mockEmployee, id: mockAdminUser.userId },
    };
    db.leaveApplication.findUnique.mockResolvedValue(application);

    mockEngine.processStageAction.mockResolvedValue({
      newStatus: 'APPROVED',
      nextStage: null,
    });

    const updatedApproved = {
      ...application,
      status: 'APPROVED',
      approvedById: mockAdminUser.userId,
      approvedAt: new Date(),
    };
    db.leaveApplication.update.mockResolvedValue(updatedApproved);

    const req = new NextRequest('http://localhost:3320/api/hr/leave/leave-701/approve', {
      method: 'POST',
    });

    const res = await approveLeave(req, { params: Promise.resolve({ id: 'leave-701' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('APPROVED');
    expect(db.attendance.upsert).toHaveBeenCalledTimes(1);
  });

  // Scenario 8: Legacy Leave record: approvalInstanceId = null -> uses legacy path
  it('Scenario 8: Legacy Leave record approval runs legacy branch and finalizes leave', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockApproverUser);

    const legacyApplication = {
      id: 'leave-801',
      employeeId: mockUser.userId,
      leaveTypeId: 'lt-casual',
      fromDate: new Date('2026-10-01'),
      toDate: new Date('2026-10-01'),
      numberOfDays: 1,
      isHalfDay: false,
      status: 'PENDING',
      approvalInstanceId: null, // Legacy record
      employee: mockEmployee,
    };
    db.leaveApplication.findUnique.mockResolvedValue(legacyApplication);

    const updatedApproved = {
      ...legacyApplication,
      status: 'APPROVED',
      approvedById: mockApproverUser.userId,
      approvedAt: new Date(),
    };
    db.leaveApplication.update.mockResolvedValue(updatedApproved);

    const req = new NextRequest('http://localhost:3320/api/hr/leave/leave-801/approve', {
      method: 'POST',
    });

    const res = await approveLeave(req, { params: Promise.resolve({ id: 'leave-801' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('APPROVED');

    // Engine is NOT called
    expect(mockEngine.processStageAction).not.toHaveBeenCalled();
    // Attendance and balance updated
    expect(db.attendance.upsert).toHaveBeenCalledTimes(1);
    expect(db.employeeLeaveBalance.upsert).toHaveBeenCalledTimes(1);
  });

  // Scenario 9: Legacy Leave record -> no ApprovalInstance fabricated
  it('Scenario 9: Legacy record approval does not fabricate ApprovalInstance or stage history', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockApproverUser);

    const legacyApplication = {
      id: 'leave-901',
      employeeId: mockUser.userId,
      leaveTypeId: 'lt-casual',
      fromDate: new Date('2026-10-01'),
      toDate: new Date('2026-10-01'),
      numberOfDays: 1,
      isHalfDay: false,
      status: 'PENDING',
      approvalInstanceId: null,
      employee: mockEmployee,
    };
    db.leaveApplication.findUnique.mockResolvedValue(legacyApplication);
    db.leaveApplication.update.mockResolvedValue({ ...legacyApplication, status: 'APPROVED' });

    const req = new NextRequest('http://localhost:3320/api/hr/leave/leave-901/approve', {
      method: 'POST',
    });

    await approveLeave(req, { params: Promise.resolve({ id: 'leave-901' }) });

    expect(mockEngine.startApprovalWorkflow).not.toHaveBeenCalled();
    expect(mockEngine.processStageAction).not.toHaveBeenCalled();
    expect(db.approvalInstance.create).not.toHaveBeenCalled();
  });

  // Scenario 10: Skip-approval workflow -> final Leave effects execute immediately
  it('Scenario 10: Skip-approval workflow path creates record and executes side effects immediately on submission', async () => {
    db.leaveType.findUnique.mockResolvedValue(mockLeaveType);
    db.leaveApplication.findFirst.mockResolvedValue(null);

    const createdApp = {
      id: 'leave-1001',
      employeeId: mockUser.userId,
      leaveTypeId: 'lt-casual',
      fromDate: new Date('2026-10-01'),
      toDate: new Date('2026-10-01'),
      numberOfDays: 1,
      status: 'PENDING',
      approvalInstanceId: null,
      employee: mockEmployee,
    };
    db.leaveApplication.create.mockResolvedValue(createdApp);

    mockEngine.startApprovalWorkflow.mockResolvedValue({
      instanceId: 'inst-auto',
      workflowName: 'Auto Approved Leave',
    });
    db.approvalInstance.findUnique.mockResolvedValue({ id: 'inst-auto', status: 'APPROVED' });

    const finalizedApproved = {
      ...createdApp,
      status: 'APPROVED',
      approvalInstanceId: 'inst-auto',
    };
    db.leaveApplication.update.mockResolvedValue(finalizedApproved);

    const req = new NextRequest('http://localhost:3320/api/hr/leave/apply', {
      method: 'POST',
      headers: { 'x-user-id': mockUser.userId },
      body: JSON.stringify({
        leaveTypeId: 'lt-casual',
        fromDate: '2026-10-01',
        toDate: '2026-10-01',
      }),
    });

    const res = await applyLeave(req);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('APPROVED');
    expect(json.data.approvalInstanceId).toBe('inst-auto');

    // Side effects ran immediately
    expect(db.attendance.upsert).toHaveBeenCalledTimes(1);
    expect(db.employeeLeaveBalance.upsert).toHaveBeenCalledTimes(1);
  });

  // Scenario 11: Leave balance safety -> no duplicate deduction on intermediate approval
  it('Scenario 11: Leave balance safety: intermediate approval does not deduct leave balance', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockApproverUser);

    const application = {
      id: 'leave-1101',
      employeeId: mockUser.userId,
      leaveTypeId: 'lt-casual',
      fromDate: new Date('2026-10-01'),
      toDate: new Date('2026-10-02'),
      numberOfDays: 2,
      isHalfDay: false,
      status: 'PENDING',
      approvalInstanceId: 'inst-1101',
      employee: mockEmployee,
    };
    db.leaveApplication.findUnique.mockResolvedValue(application);

    mockEngine.processStageAction.mockResolvedValue({
      newStatus: 'IN_PROGRESS',
      nextStage: 'Director Approval',
    });

    const req = new NextRequest('http://localhost:3320/api/hr/leave/leave-1101/approve', {
      method: 'POST',
    });

    await approveLeave(req, { params: Promise.resolve({ id: 'leave-1101' }) });

    expect(db.employeeLeaveBalance.upsert).not.toHaveBeenCalled();
  });

  // Scenario 12: Attendance safety -> no premature final attendance mutation on intermediate approval
  it('Scenario 12: Attendance safety: intermediate approval does not mark attendance', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockApproverUser);

    const application = {
      id: 'leave-1201',
      employeeId: mockUser.userId,
      leaveTypeId: 'lt-casual',
      fromDate: new Date('2026-10-01'),
      toDate: new Date('2026-10-02'),
      numberOfDays: 2,
      isHalfDay: false,
      status: 'PENDING',
      approvalInstanceId: 'inst-1201',
      employee: mockEmployee,
    };
    db.leaveApplication.findUnique.mockResolvedValue(application);

    mockEngine.processStageAction.mockResolvedValue({
      newStatus: 'IN_PROGRESS',
      nextStage: 'Director Approval',
    });

    const req = new NextRequest('http://localhost:3320/api/hr/leave/leave-1201/approve', {
      method: 'POST',
    });

    await approveLeave(req, { params: Promise.resolve({ id: 'leave-1201' }) });

    expect(db.attendance.upsert).not.toHaveBeenCalled();
    expect(db.attendance.update).not.toHaveBeenCalled();
  });

  // Scenario 13: Existing cancellation/withdrawal behavior -> remains unchanged
  it('Scenario 13: Cancel pending leave sets CANCELLED and cancels record approval', async () => {
    const application = {
      id: 'leave-1301',
      employeeId: mockUser.userId,
      status: 'PENDING',
    };
    db.leaveApplication.findUnique.mockResolvedValue(application);
    db.leaveApplication.update.mockResolvedValue({ ...application, status: 'CANCELLED' });

    const req = new NextRequest('http://localhost:3320/api/hr/leave/leave-1301/cancel', {
      method: 'POST',
      headers: { 'x-user-id': mockUser.userId },
    });

    const res = await cancelLeave(req, { params: Promise.resolve({ id: 'leave-1301' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('CANCELLED');
    expect(mockRecordApproval.cancelRecordApproval).toHaveBeenCalledWith('LeaveApplication', 'leave-1301', mockUser.userId);
  });

  // Scenario 14: GET / list / detail behavior -> existing UI data remains intact
  it('Scenario 14: GET /api/hr/leave preserves UI data, calculated balances, and approval details', async () => {
    const mockList = [
      {
        id: 'leave-1',
        employeeId: mockUser.userId,
        leaveTypeId: 'lt-casual',
        fromDate: new Date('2026-10-01'),
        numberOfDays: 2,
        status: 'PENDING',
        employee: { branchId: 'branch-1' },
      },
    ];
    db.leaveApplication.findMany.mockResolvedValue(mockList);

    const approvalMap = new Map();
    approvalMap.set('leave-1', {
      stageName: 'Branch Manager Approval',
      stageNumber: 1,
      totalStages: 1,
      approverRoleSlug: 'branch-manager',
      canAct: true,
    });
    mockRecordApproval.describePendingApprovals.mockResolvedValue(approvalMap);

    const balanceMap = new Map();
    balanceMap.set(`${mockUser.userId}:lt-casual`, 5);
    mockAttendanceLeave.getRemainingLeaveBalancesBatch.mockResolvedValue(balanceMap);

    mockPermissions.getUserContext.mockResolvedValue(mockUser);

    const req = new NextRequest('http://localhost:3320/api/hr/leave');
    const res = await getLeaves(req);
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
    expect(json.data[0].remainingBalance).toBe(5);
    expect(json.data[0].numberOfDays).toBe(2);
    expect(json.data[0].excessDaysIfApproved).toBe(0);
  });
});

