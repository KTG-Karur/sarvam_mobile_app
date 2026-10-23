import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { UserContext } from '@/app/lib/permissions/types';

// The create route rejects past effective dates, so a fixed date (e.g.
// '2026-10-01') silently starts failing once it passes — keep it in the future.
const FUTURE_DATE = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

// Mock DB and external services
const db = vi.hoisted(() => {
  const employeePromotion = {
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
  const designation = {
    findUnique: vi.fn(),
  };
  const role = {
    findFirst: vi.fn(),
  };
  const userRoleAssignment = {
    findFirst: vi.fn(),
    create: vi.fn(),
  };
  const approvalInstance = {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
  };
  const tx = {
    employeePromotion,
    user,
    designation,
    role,
    userRoleAssignment,
    approvalInstance,
  };
  return {
    employeePromotion,
    user,
    designation,
    role,
    userRoleAssignment,
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
  buildPromotionLetterPdf: vi.fn().mockResolvedValue(Buffer.from('mock-promotion-pdf')),
}));

vi.mock('@/app/lib/reports/promotion-letter-pdf', () => ({
  buildPromotionLetterPdf: mockPdf.buildPromotionLetterPdf,
}));

const mockStorage = vi.hoisted(() => ({
  uploadHrLetter: vi.fn().mockResolvedValue('https://storage/promotion-letter.pdf'),
}));

vi.mock('@/app/lib/storage/hr-letter-storage', () => ({
  uploadHrLetter: mockStorage.uploadHrLetter,
}));

const mockRoleSync = vi.hoisted(() => ({
  syncUserLegacyRoleFromActiveAssignments: vi.fn().mockResolvedValue(undefined),
  invalidateUserPermissions: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/app/lib/rbac-role-sync', () => ({
  syncUserLegacyRoleFromActiveAssignments: mockRoleSync.syncUserLegacyRoleFromActiveAssignments,
}));

vi.mock('@/app/lib/permissions/engine', () => ({
  invalidateUserPermissions: mockRoleSync.invalidateUserPermissions,
}));

import { POST as createPromotion, GET as getPromotions } from './route';
import { POST as approvePromotion } from './[id]/approve/route';
import { POST as rejectPromotion } from './[id]/reject/route';

describe('HR Promotion Approval Engine Migration', () => {
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
    designationId: 'desig-old',
    branchId: 'branch-1',
    department: { name: 'Operations' },
    branch: { name: 'City Branch' },
  };

  const mockToDesignation = {
    id: 'desig-new',
    name: 'Senior Officer',
    defaultRoleSlug: 'senior-officer',
  };

  const mockTargetRole = {
    id: 'role-sr-officer',
    slug: 'senior-officer',
    isActive: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPermissions.isEmployeeBranchPermitted.mockReturnValue(true);
  });

  // Scenario 1: Standard single-stage promotion creation + approval -> terminal status APPROVED, letter generated/stored, User.designationId updated, user role synced/assigned, permission cache invalidated
  it('Scenario 1: Standard single-stage promotion creation + approval -> terminal APPROVED + full side effects', async () => {
    // 1A. Creation
    mockPermissions.requirePermission.mockResolvedValue(mockUser);
    db.user.findUnique.mockResolvedValue(mockEmployee);
    db.designation.findUnique.mockResolvedValue(mockToDesignation);
    db.employeePromotion.findFirst.mockResolvedValue(null);

    const createdRecord = {
      id: 'prm-101',
      employeeId: 'emp-1',
      fromDesignationId: 'desig-old',
      toDesignationId: 'desig-new',
      effectiveDate: new Date(FUTURE_DATE),
      status: 'PENDING',
      initiatedById: mockUser.userId,
      approvalInstanceId: null,
      employee: { id: 'emp-1', firstName: 'John', lastName: 'Doe', employeeId: 'EMP-001' },
      toDesignation: { id: 'desig-new', name: 'Senior Officer' },
    };
    db.employeePromotion.create.mockResolvedValue(createdRecord);

    mockEngine.startApprovalWorkflow.mockResolvedValue({
      instanceId: 'inst-prm-101',
      workflowName: 'Admin-Only Promotion Approval',
    });
    db.approvalInstance.findUnique.mockResolvedValue({ id: 'inst-prm-101', status: 'PENDING' });

    const updatedPending = {
      ...createdRecord,
      approvalInstanceId: 'inst-prm-101',
    };
    db.employeePromotion.update.mockResolvedValue(updatedPending);

    const createReq = new NextRequest('http://localhost:3320/api/hr/promotions', {
      method: 'POST',
      body: JSON.stringify({
        employeeId: 'emp-1',
        toDesignationId: 'desig-new',
        effectiveDate: FUTURE_DATE,
        reason: 'Exceptional performance',
      }),
    });

    const createRes = await createPromotion(createReq);
    const createJson = await createRes.json();

    expect(createRes.status).toBe(201);
    expect(createJson.success).toBe(true);
    expect(createJson.data.approvalInstanceId).toBe('inst-prm-101');
    expect(createJson.data.status).toBe('PENDING');
    expect(mockEngine.startApprovalWorkflow).toHaveBeenCalledWith({
      moduleSlug: 'hr-promotion',
      recordType: 'EmployeePromotion',
      recordId: 'prm-101',
      branchId: 'branch-1',
      submittedByUserId: mockUser.userId,
    });
    expect(mockPdf.buildPromotionLetterPdf).not.toHaveBeenCalled();
    expect(mockStorage.uploadHrLetter).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();

    // 1B. Approval by Approver
    mockPermissions.requirePermission.mockResolvedValue(mockApproverUser);
    const promotionWithRelations = {
      ...updatedPending,
      employee: mockEmployee,
      toDesignation: mockToDesignation,
    };
    db.employeePromotion.findUnique.mockResolvedValue(promotionWithRelations);

    mockEngine.processStageAction.mockResolvedValue({
      newStatus: 'APPROVED',
      nextStage: null,
    });

    db.role.findFirst.mockResolvedValue(mockTargetRole);
    db.userRoleAssignment.findFirst.mockResolvedValue(null);
    db.userRoleAssignment.create.mockResolvedValue({ id: 'ura-1' });

    const updatedApproved = {
      ...promotionWithRelations,
      status: 'APPROVED',
      reviewedById: mockApproverUser.userId,
      reviewedAt: new Date(),
      letterUrl: 'https://storage/promotion-letter.pdf',
    };
    db.employeePromotion.update.mockResolvedValue(updatedApproved);

    const approveReq = new NextRequest('http://localhost:3320/api/hr/promotions/prm-101/approve', {
      method: 'POST',
    });

    const approveRes = await approvePromotion(approveReq, { params: Promise.resolve({ id: 'prm-101' }) });
    const approveJson = await approveRes.json();

    expect(approveRes.status).toBe(200);
    expect(approveJson.success).toBe(true);
    expect(mockEngine.processStageAction).toHaveBeenCalledWith(
      {
        instanceId: 'inst-prm-101',
        actorUserId: mockApproverUser.userId,
        action: 'approve',
      },
      mockApproverUser
    );
    expect(mockPdf.buildPromotionLetterPdf).toHaveBeenCalledTimes(1);
    expect(mockStorage.uploadHrLetter).toHaveBeenCalledWith({
      employeeId: 'emp-1',
      letterType: 'promotion',
      pdfBuffer: expect.any(Buffer),
    });
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 'emp-1' },
      data: { designationId: 'desig-new' },
    });
    expect(db.userRoleAssignment.create).toHaveBeenCalledWith({
      data: {
        userId: 'emp-1',
        roleId: 'role-sr-officer',
        branchId: null,
        assignedBy: mockApproverUser.userId,
        isActive: true,
      },
    });
    expect(mockRoleSync.syncUserLegacyRoleFromActiveAssignments).toHaveBeenCalledWith('emp-1');
    expect(mockRoleSync.invalidateUserPermissions).toHaveBeenCalledWith('emp-1');
  });

  // Scenario 2: Multi-stage promotion: stage 1 approve advances instance and leaves promotion PENDING with NO side effects
  it('Scenario 2: Multi-stage promotion: stage 1 approve advances instance and leaves promotion PENDING with NO side effects', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockApproverUser);

    const promotion = {
      id: 'prm-201',
      employeeId: 'emp-1',
      toDesignationId: 'desig-new',
      effectiveDate: new Date(FUTURE_DATE),
      status: 'PENDING',
      initiatedById: mockUser.userId,
      approvalInstanceId: 'inst-multi',
      employee: mockEmployee,
      toDesignation: mockToDesignation,
    };
    db.employeePromotion.findUnique.mockResolvedValue(promotion);

    mockEngine.processStageAction.mockResolvedValue({
      newStatus: 'IN_PROGRESS',
      nextStage: 'HR Head Approval',
    });

    const req = new NextRequest('http://localhost:3320/api/hr/promotions/prm-201/approve', {
      method: 'POST',
    });

    const res = await approvePromotion(req, { params: Promise.resolve({ id: 'prm-201' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.message).toContain('Approved at this level — now awaiting HR Head Approval');
    expect(json.data.status).toBe('PENDING');

    // Zero side effects on intermediate stage
    expect(mockPdf.buildPromotionLetterPdf).not.toHaveBeenCalled();
    expect(mockStorage.uploadHrLetter).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
    expect(db.userRoleAssignment.create).not.toHaveBeenCalled();
    expect(mockRoleSync.syncUserLegacyRoleFromActiveAssignments).not.toHaveBeenCalled();
    expect(mockRoleSync.invalidateUserPermissions).not.toHaveBeenCalled();
  });

  // Scenario 3: Final stage approve of multi-stage promotion completes instance -> terminal APPROVED + full side effects execute once
  it('Scenario 3: Final stage approve of multi-stage promotion completes instance -> terminal APPROVED + full side effects execute once', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockAdminUser);

    const promotion = {
      id: 'prm-201',
      employeeId: 'emp-1',
      toDesignationId: 'desig-new',
      effectiveDate: new Date(FUTURE_DATE),
      status: 'PENDING',
      initiatedById: mockUser.userId,
      approvalInstanceId: 'inst-multi',
      employee: mockEmployee,
      toDesignation: mockToDesignation,
    };
    db.employeePromotion.findUnique.mockResolvedValue(promotion);

    mockEngine.processStageAction.mockResolvedValue({
      newStatus: 'APPROVED',
      nextStage: null,
    });

    db.role.findFirst.mockResolvedValue(mockTargetRole);
    db.userRoleAssignment.findFirst.mockResolvedValue(null);

    const updatedApproved = {
      ...promotion,
      status: 'APPROVED',
      reviewedById: mockAdminUser.userId,
      reviewedAt: new Date(),
    };
    db.employeePromotion.update.mockResolvedValue(updatedApproved);

    const req = new NextRequest('http://localhost:3320/api/hr/promotions/prm-201/approve', {
      method: 'POST',
    });

    const res = await approvePromotion(req, { params: Promise.resolve({ id: 'prm-201' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('APPROVED');
    expect(mockPdf.buildPromotionLetterPdf).toHaveBeenCalledTimes(1);
    expect(mockStorage.uploadHrLetter).toHaveBeenCalledTimes(1);
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 'emp-1' },
      data: { designationId: 'desig-new' },
    });
    expect(db.userRoleAssignment.create).toHaveBeenCalledTimes(1);
    expect(mockRoleSync.syncUserLegacyRoleFromActiveAssignments).toHaveBeenCalledWith('emp-1');
    expect(mockRoleSync.invalidateUserPermissions).toHaveBeenCalledWith('emp-1');
  });

  // Scenario 4: Non-admin initiator cannot self-approve on the engine path (400)
  it('Scenario 4: Non-admin initiator cannot self-approve on the engine path (400)', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockUser);

    const promotion = {
      id: 'prm-401',
      employeeId: 'emp-1',
      toDesignationId: 'desig-new',
      effectiveDate: new Date(FUTURE_DATE),
      status: 'PENDING',
      initiatedById: mockUser.userId, // same as actor
      approvalInstanceId: 'inst-401',
      employee: mockEmployee,
      toDesignation: mockToDesignation,
    };
    db.employeePromotion.findUnique.mockResolvedValue(promotion);

    mockEngine.processStageAction.mockRejectedValue(new Error('Self-approval is not allowed'));

    const req = new NextRequest('http://localhost:3320/api/hr/promotions/prm-401/approve', {
      method: 'POST',
    });

    const res = await approvePromotion(req, { params: Promise.resolve({ id: 'prm-401' }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Self-approval is not allowed');
    expect(mockPdf.buildPromotionLetterPdf).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  // Scenario 5: Admin initiator CAN self-approve on the engine path and advance/finalize
  it('Scenario 5: Admin initiator CAN self-approve on the engine path and advance/finalize', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockAdminUser);

    const promotion = {
      id: 'prm-501',
      employeeId: 'emp-1',
      toDesignationId: 'desig-new',
      effectiveDate: new Date(FUTURE_DATE),
      status: 'PENDING',
      initiatedById: mockAdminUser.userId, // Admin is submitter
      approvalInstanceId: 'inst-501',
      employee: mockEmployee,
      toDesignation: mockToDesignation,
    };
    db.employeePromotion.findUnique.mockResolvedValue(promotion);

    mockEngine.processStageAction.mockResolvedValue({
      newStatus: 'APPROVED',
      nextStage: null,
    });

    db.role.findFirst.mockResolvedValue(mockTargetRole);
    db.userRoleAssignment.findFirst.mockResolvedValue(null);

    const updatedApproved = {
      ...promotion,
      status: 'APPROVED',
      reviewedById: mockAdminUser.userId,
      reviewedAt: new Date(),
    };
    db.employeePromotion.update.mockResolvedValue(updatedApproved);

    const req = new NextRequest('http://localhost:3320/api/hr/promotions/prm-501/approve', {
      method: 'POST',
    });

    const res = await approvePromotion(req, { params: Promise.resolve({ id: 'prm-501' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('APPROVED');
    expect(mockPdf.buildPromotionLetterPdf).toHaveBeenCalledTimes(1);
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 'emp-1' },
      data: { designationId: 'desig-new' },
    });
  });

  // Scenario 6: Reject at stage 1 terminates as REJECTED with NO side effects
  it('Scenario 6: Reject at stage 1 terminates as REJECTED with NO side effects', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockApproverUser);

    const promotion = {
      id: 'prm-601',
      employeeId: 'emp-1',
      toDesignationId: 'desig-new',
      status: 'PENDING',
      initiatedById: mockUser.userId,
      approvalInstanceId: 'inst-601',
      employee: mockEmployee,
      toDesignation: mockToDesignation,
    };
    db.employeePromotion.findUnique.mockResolvedValue(promotion);

    mockEngine.processStageAction.mockResolvedValue({
      newStatus: 'REJECTED',
      nextStage: null,
    });

    const updatedRejected = {
      ...promotion,
      status: 'REJECTED',
      reviewedById: mockApproverUser.userId,
      reviewedAt: new Date(),
      reviewRemarks: 'Target requirements not met',
    };
    db.employeePromotion.update.mockResolvedValue(updatedRejected);

    const req = new NextRequest('http://localhost:3320/api/hr/promotions/prm-601/reject', {
      method: 'POST',
      body: JSON.stringify({ reviewRemarks: 'Target requirements not met' }),
    });

    const res = await rejectPromotion(req, { params: Promise.resolve({ id: 'prm-601' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('REJECTED');
    expect(mockEngine.processStageAction).toHaveBeenCalledWith(
      {
        instanceId: 'inst-601',
        actorUserId: mockApproverUser.userId,
        action: 'reject',
        remarks: 'Target requirements not met',
      },
      mockApproverUser
    );

    // Zero side effects on rejection
    expect(mockPdf.buildPromotionLetterPdf).not.toHaveBeenCalled();
    expect(mockStorage.uploadHrLetter).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
    expect(db.userRoleAssignment.create).not.toHaveBeenCalled();
    expect(mockRoleSync.syncUserLegacyRoleFromActiveAssignments).not.toHaveBeenCalled();
    expect(mockRoleSync.invalidateUserPermissions).not.toHaveBeenCalled();
  });

  // Scenario 7: Reject on legacy record sets REJECTED with NO side effects
  it('Scenario 7: Reject on legacy record sets REJECTED with NO side effects', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockApproverUser);

    const legacyPromotion = {
      id: 'prm-701',
      employeeId: 'emp-1',
      toDesignationId: 'desig-new',
      status: 'PENDING',
      initiatedById: mockUser.userId,
      approvalInstanceId: null, // Legacy record
      employee: mockEmployee,
      toDesignation: mockToDesignation,
    };
    db.employeePromotion.findUnique.mockResolvedValue(legacyPromotion);

    const updatedRejected = {
      ...legacyPromotion,
      status: 'REJECTED',
      reviewedById: mockApproverUser.userId,
      reviewedAt: new Date(),
      reviewRemarks: 'Not eligible yet',
    };
    db.employeePromotion.update.mockResolvedValue(updatedRejected);

    const req = new NextRequest('http://localhost:3320/api/hr/promotions/prm-701/reject', {
      method: 'POST',
      body: JSON.stringify({ reviewRemarks: 'Not eligible yet' }),
    });

    const res = await rejectPromotion(req, { params: Promise.resolve({ id: 'prm-701' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('REJECTED');

    // Generic engine MUST NOT be called for legacy rejection
    expect(mockEngine.processStageAction).not.toHaveBeenCalled();
    // Zero side effects
    expect(mockPdf.buildPromotionLetterPdf).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  // Scenario 8: Legacy record approval (approvalInstanceId = null) runs legacy branch, updates status to APPROVED, runs side effects, and does NOT create/fabricate approvalInstance
  it('Scenario 8: Legacy record approval (approvalInstanceId = null) runs legacy branch, updates status to APPROVED, runs side effects, and does NOT create/fabricate approvalInstance', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockApproverUser);

    const legacyPromotion = {
      id: 'prm-801',
      employeeId: 'emp-1',
      toDesignationId: 'desig-new',
      effectiveDate: new Date(FUTURE_DATE),
      status: 'PENDING',
      initiatedById: mockUser.userId,
      approvalInstanceId: null, // Legacy record
      employee: mockEmployee,
      toDesignation: mockToDesignation,
    };
    db.employeePromotion.findUnique.mockResolvedValue(legacyPromotion);
    db.role.findFirst.mockResolvedValue(mockTargetRole);
    db.userRoleAssignment.findFirst.mockResolvedValue(null);

    const updatedApproved = {
      ...legacyPromotion,
      status: 'APPROVED',
      reviewedById: mockApproverUser.userId,
      reviewedAt: new Date(),
      letterUrl: 'https://storage/promotion-letter.pdf',
    };
    db.employeePromotion.update.mockResolvedValue(updatedApproved);

    const req = new NextRequest('http://localhost:3320/api/hr/promotions/prm-801/approve', {
      method: 'POST',
    });

    const res = await approvePromotion(req, { params: Promise.resolve({ id: 'prm-801' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('APPROVED');

    // Generic engine MUST NOT be called for legacy records (no fabricated instance)
    expect(mockEngine.processStageAction).not.toHaveBeenCalled();
    expect(mockEngine.startApprovalWorkflow).not.toHaveBeenCalled();
    expect(db.approvalInstance.create).not.toHaveBeenCalled();

    // Side effects DO execute for legacy approval
    expect(mockPdf.buildPromotionLetterPdf).toHaveBeenCalledTimes(1);
    expect(mockStorage.uploadHrLetter).toHaveBeenCalledTimes(1);
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 'emp-1' },
      data: { designationId: 'desig-new' },
    });
    expect(mockRoleSync.syncUserLegacyRoleFromActiveAssignments).toHaveBeenCalledWith('emp-1');
    expect(mockRoleSync.invalidateUserPermissions).toHaveBeenCalledWith('emp-1');
  });

  // Scenario 9: Legacy non-admin self-approval blocked (400)
  it('Scenario 9: Legacy non-admin self-approval blocked (400)', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockUser);

    const legacyPromotion = {
      id: 'prm-901',
      employeeId: 'emp-1',
      toDesignationId: 'desig-new',
      effectiveDate: new Date(FUTURE_DATE),
      status: 'PENDING',
      initiatedById: mockUser.userId, // Same as actor
      approvalInstanceId: null, // Legacy record
      employee: mockEmployee,
      toDesignation: mockToDesignation,
    };
    db.employeePromotion.findUnique.mockResolvedValue(legacyPromotion);

    const req = new NextRequest('http://localhost:3320/api/hr/promotions/prm-901/approve', {
      method: 'POST',
    });

    const res = await approvePromotion(req, { params: Promise.resolve({ id: 'prm-901' }) });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toBe('Self-approval is not allowed');

    // Engine not called, no side effects
    expect(mockEngine.processStageAction).not.toHaveBeenCalled();
    expect(mockPdf.buildPromotionLetterPdf).not.toHaveBeenCalled();
    expect(db.user.update).not.toHaveBeenCalled();
  });

  // Scenario 9b: Legacy admin self-approval allowed
  it('Scenario 9b: Legacy admin self-approval allowed', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockAdminUser);

    const legacyPromotion = {
      id: 'prm-902',
      employeeId: 'emp-1',
      toDesignationId: 'desig-new',
      effectiveDate: new Date(FUTURE_DATE),
      status: 'PENDING',
      initiatedById: mockAdminUser.userId, // Admin is the initiator
      approvalInstanceId: null, // Legacy record
      employee: mockEmployee,
      toDesignation: mockToDesignation,
    };
    db.employeePromotion.findUnique.mockResolvedValue(legacyPromotion);
    db.designation.findUnique.mockResolvedValue(mockToDesignation);
    db.role.findFirst.mockResolvedValue(mockTargetRole);
    db.userRoleAssignment.findFirst.mockResolvedValue(null);
    db.employeePromotion.update.mockResolvedValue({
      ...legacyPromotion,
      status: 'APPROVED',
      reviewedById: mockAdminUser.userId,
    });

    const req = new NextRequest('http://localhost:3320/api/hr/promotions/prm-902/approve', {
      method: 'POST',
    });

    const res = await approvePromotion(req, { params: Promise.resolve({ id: 'prm-902' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockPdf.buildPromotionLetterPdf).toHaveBeenCalledTimes(1);
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 'emp-1' },
      data: { designationId: 'desig-new' },
    });
  });

  // Scenario 9c: Discovers and links existing open approval instance if approvalInstanceId is null
  it('Scenario 9c: Discovers and links existing open approval instance if approvalInstanceId is null', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockAdminUser);

    const unlinkedPromotion = {
      id: 'prm-903',
      employeeId: 'emp-1',
      toDesignationId: 'desig-new',
      effectiveDate: new Date(FUTURE_DATE),
      status: 'PENDING',
      initiatedById: mockAdminUser.userId,
      approvalInstanceId: null, // Unlinked
      employee: mockEmployee,
      toDesignation: mockToDesignation,
    };
    db.employeePromotion.findUnique.mockResolvedValue(unlinkedPromotion);
    db.approvalInstance.findFirst.mockResolvedValue({ id: 'inst-found-123' });
    mockEngine.processStageAction.mockResolvedValue({
      newStatus: 'APPROVED',
      nextStage: null,
    });
    db.designation.findUnique.mockResolvedValue(mockToDesignation);
    db.role.findFirst.mockResolvedValue(mockTargetRole);
    db.userRoleAssignment.findFirst.mockResolvedValue(null);
    db.employeePromotion.update.mockResolvedValue({
      ...unlinkedPromotion,
      status: 'APPROVED',
      approvalInstanceId: 'inst-found-123',
    });

    const req = new NextRequest('http://localhost:3320/api/hr/promotions/prm-903/approve', {
      method: 'POST',
    });

    const res = await approvePromotion(req, { params: Promise.resolve({ id: 'prm-903' }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockEngine.processStageAction).toHaveBeenCalledWith(
      expect.objectContaining({
        instanceId: 'inst-found-123',
        action: 'approve',
      }),
      mockAdminUser
    );
  });

  // Scenario 10: Skip-approval workflow path creates record and executes side effects immediately on submission
  it('Scenario 10: Skip-approval workflow path creates record and executes side effects immediately on submission', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockUser);
    db.user.findUnique.mockResolvedValue(mockEmployee);
    db.designation.findUnique.mockResolvedValue(mockToDesignation);
    db.employeePromotion.findFirst.mockResolvedValue(null);

    const createdRecord = {
      id: 'prm-1001',
      employeeId: 'emp-1',
      fromDesignationId: 'desig-old',
      toDesignationId: 'desig-new',
      effectiveDate: new Date(FUTURE_DATE),
      status: 'PENDING',
      initiatedById: mockUser.userId,
      approvalInstanceId: null,
      employee: { id: 'emp-1', firstName: 'John', lastName: 'Doe', employeeId: 'EMP-001' },
      toDesignation: { id: 'desig-new', name: 'Senior Officer' },
    };
    db.employeePromotion.create.mockResolvedValue(createdRecord);

    mockEngine.startApprovalWorkflow.mockResolvedValue({
      instanceId: 'inst-prm-auto',
      workflowName: 'Auto Approved Workflow',
    });
    // Instance status is APPROVED -> triggers skip approval
    db.approvalInstance.findUnique.mockResolvedValue({ id: 'inst-prm-auto', status: 'APPROVED' });

    db.role.findFirst.mockResolvedValue(mockTargetRole);
    db.userRoleAssignment.findFirst.mockResolvedValue(null);

    const finalizedApproved = {
      ...createdRecord,
      status: 'APPROVED',
      approvalInstanceId: 'inst-prm-auto',
      reviewedById: mockUser.userId,
      reviewedAt: new Date(),
      letterUrl: 'https://storage/promotion-letter.pdf',
    };
    db.employeePromotion.update.mockResolvedValue(finalizedApproved);

    const createReq = new NextRequest('http://localhost:3320/api/hr/promotions', {
      method: 'POST',
      body: JSON.stringify({
        employeeId: 'emp-1',
        toDesignationId: 'desig-new',
        effectiveDate: FUTURE_DATE,
        reason: 'CEO Special Promotion',
      }),
    });

    const res = await createPromotion(createReq);
    const json = await res.json();

    expect(res.status).toBe(201);
    expect(json.success).toBe(true);
    expect(json.data.status).toBe('APPROVED');
    expect(json.data.approvalInstanceId).toBe('inst-prm-auto');

    // Side effects execute immediately upon submission
    expect(mockPdf.buildPromotionLetterPdf).toHaveBeenCalledTimes(1);
    expect(mockStorage.uploadHrLetter).toHaveBeenCalledWith({
      employeeId: 'emp-1',
      letterType: 'promotion',
      pdfBuffer: expect.any(Buffer),
    });
    expect(db.user.update).toHaveBeenCalledWith({
      where: { id: 'emp-1' },
      data: { designationId: 'desig-new' },
    });
    expect(mockRoleSync.syncUserLegacyRoleFromActiveAssignments).toHaveBeenCalledWith('emp-1');
    expect(mockRoleSync.invalidateUserPermissions).toHaveBeenCalledWith('emp-1');
  });

  // Extra: GET /api/hr/promotions
  it('GET /api/hr/promotions fetches promotions and maps pending approval descriptions', async () => {
    mockPermissions.requirePermission.mockResolvedValue(mockUser);
    const mockList = [
      {
        id: 'prm-1',
        status: 'PENDING',
        employee: { branchId: 'branch-1' },
      },
      {
        id: 'prm-2',
        status: 'APPROVED',
        employee: { branchId: 'branch-1' },
      },
    ];
    db.employeePromotion.findMany.mockResolvedValue(mockList);

    const approvalMap = new Map();
    approvalMap.set('prm-1', {
      stageName: 'Branch Manager Approval',
      stageNumber: 1,
      totalStages: 1,
      approverRoleSlug: 'branch-manager',
      canAct: true,
    });
    mockRecordApproval.describePendingApprovals.mockResolvedValue(approvalMap);

    const req = new NextRequest('http://localhost:3320/api/hr/promotions');
    const res = await getPromotions(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.data).toHaveLength(2);
    expect(json.data[0].approval).toEqual({
      stageName: 'Branch Manager Approval',
      stageNumber: 1,
      totalStages: 1,
      approverRoleSlug: 'branch-manager',
      canAct: true,
    });
    expect(json.data[1].approval).toBeNull();
  });
});
