import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { UserContext } from '@/app/lib/permissions/types';

const db = vi.hoisted(() => {
  const tx = {
    approvalInstance: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    approvalInstanceStage: {
      createMany: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    approvalLog: {
      create: vi.fn(),
    },
    module: {
      findUnique: vi.fn(),
    },
  };
  return {
    tx,
    prisma: {
      ...tx,
      $transaction: vi.fn(async (cb: (txClient: typeof tx) => Promise<unknown>) => cb(tx)),
    },
  };
});

vi.mock('@/app/lib/prisma', () => ({
  prisma: db.prisma,
}));

vi.mock('./ensure-defaults', () => ({
  ensureDefaultWorkflow: vi.fn().mockResolvedValue(false),
}));

import { processStageAction, startApprovalWorkflow } from './engine';

describe('Approval Workflow Engine Core', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createMockInstance = (overrides: Record<string, unknown> = {}) => ({
    id: 'inst-1',
    workflowId: 'wf-1',
    recordType: 'hr_confirmation',
    recordId: 'conf-1',
    branchId: 'branch-1',
    submittedBy: 'user-submitter',
    status: 'PENDING',
    currentStageId: 'stage-1',
    workflow: {
      id: 'wf-1',
      name: 'Confirmation Approval',
      stages: [
        {
          id: 'stage-1',
          name: 'BM Review',
          stageOrder: 1,
          approverRoleSlug: 'branch-manager',
          allowedActions: ['approve', 'reject'],
        },
      ],
    },
    stageInstances: [
      {
        id: 'inst-stage-1',
        instanceId: 'inst-1',
        stageId: 'stage-1',
        status: 'PENDING',
      },
    ],
    ...overrides,
  });

  const createMockUserContext = (overrides: Partial<UserContext> = {}): UserContext => ({
    userId: 'user-1',
    email: 'test@example.com',
    firstName: 'Test',
    lastName: 'User',
    isActive: true,
    branchId: 'branch-1',
    isHeadOffice: false,
    roles: [
      {
        roleId: 'role-1',
        roleName: 'Branch Manager',
        roleSlug: 'branch-manager',
        priority: 10,
        branchId: null,
      },
    ],
    permissions: {
      granted: new Set(),
      denied: new Set(),
      conditions: new Map(),
    },
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

  describe('Maker-Checker Rule', () => {
    it('blocks non-admin self-approval with "Self-approval is not allowed"', async () => {
      const instance = createMockInstance({ submittedBy: 'user-initiator' });
      db.prisma.approvalInstance.findUnique.mockResolvedValue(instance);

      const nonAdminContext = createMockUserContext({
        userId: 'user-initiator',
        isHeadOffice: false,
        roles: [
          {
            roleId: 'role-bm',
            roleName: 'Branch Manager',
            roleSlug: 'branch-manager',
            priority: 10,
            branchId: null,
          },
        ],
      });

      await expect(
        processStageAction(
          {
            instanceId: 'inst-1',
            actorUserId: 'user-initiator',
            action: 'approve',
          },
          nonAdminContext
        )
      ).rejects.toThrow('Self-approval is not allowed');
    });

    it('allows admin self-approval for emergency/administrative bypass', async () => {
      const instance = createMockInstance({ submittedBy: 'admin-user' });
      db.prisma.approvalInstance.findUnique.mockResolvedValue(instance);
      db.tx.approvalInstance.updateMany.mockResolvedValue({ count: 1 });
      db.tx.approvalInstanceStage.update.mockResolvedValue({});
      db.tx.approvalInstance.update.mockResolvedValue({});
      db.tx.approvalLog.create.mockResolvedValue({});

      const adminContext = createMockUserContext({
        userId: 'admin-user',
        isHeadOffice: true,
        roles: [
          {
            roleId: 'role-admin',
            roleName: 'Administrator',
            roleSlug: 'admin',
            priority: 100,
            branchId: null,
          },
        ],
      });

      const result = await processStageAction(
        {
          instanceId: 'inst-1',
          actorUserId: 'admin-user',
          action: 'approve',
        },
        adminContext
      );

      expect(result.newStatus).toBe('APPROVED');
    });

    it('allows cross-person approval when actor is different from submitter', async () => {
      const instance = createMockInstance({ submittedBy: 'user-initiator' });
      db.prisma.approvalInstance.findUnique.mockResolvedValue(instance);
      db.tx.approvalInstance.updateMany.mockResolvedValue({ count: 1 });
      db.tx.approvalInstanceStage.update.mockResolvedValue({});
      db.tx.approvalInstance.update.mockResolvedValue({});
      db.tx.approvalLog.create.mockResolvedValue({});

      const reviewerContext = createMockUserContext({
        userId: 'user-reviewer',
        isHeadOffice: false,
        roles: [
          {
            roleId: 'role-bm',
            roleName: 'Branch Manager',
            roleSlug: 'branch-manager',
            priority: 10,
            branchId: null,
          },
        ],
      });

      const result = await processStageAction(
        {
          instanceId: 'inst-1',
          actorUserId: 'user-reviewer',
          action: 'approve',
        },
        reviewerContext
      );

      expect(result.newStatus).toBe('APPROVED');
    });
  });

  describe('Skip-Approval Short-Circuit Path', () => {
    it('creates an APPROVED instance with audit log, completedAt, and zero stage rows when skipApproval is set', async () => {
      const mockModule = {
        id: 'mod-1',
        slug: 'hr-confirmation',
        name: 'HR Confirmation',
        approvalWorkflows: [
          {
            id: 'wf-skip-1',
            name: 'Direct Confirmation',
            isDefault: true,
            isActive: true,
            stages: [],
          },
        ],
      };

      db.prisma.module.findUnique.mockResolvedValue(mockModule);
      db.tx.approvalInstance.create.mockImplementation(async ({ data }) => ({
        id: 'inst-auto-1',
        ...data,
      }));
      db.tx.approvalLog.create.mockResolvedValue({});

      const result = await startApprovalWorkflow({
        moduleSlug: 'hr-confirmation',
        recordType: 'hr_confirmation',
        recordId: 'conf-123',
        branchId: 'branch-1',
        submittedByUserId: 'user-submitter',
        skipApproval: true,
        skippedReason: 'Direct confirmation auto-approval enabled',
      });

      expect(result.instanceId).toBe('inst-auto-1');
      expect(result.workflowName).toBe('Direct Confirmation');

      // Verify instance created with APPROVED status, null currentStageId, and completedAt
      expect(db.tx.approvalInstance.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'APPROVED',
          currentStageId: null,
          completedAt: expect.any(Date),
          metadata: expect.objectContaining({
            skippedReason: 'Direct confirmation auto-approval enabled',
          }),
        }),
      });

      // Verify auto_approved audit log created
      expect(db.tx.approvalLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          instanceId: 'inst-auto-1',
          action: 'auto_approved',
          stageName: null,
          remarks: 'Direct confirmation auto-approval enabled',
        }),
      });

      // Verify ZERO stage rows were created
      expect(db.tx.approvalInstanceStage.createMany).not.toHaveBeenCalled();
    });
  });

  describe('Branch and Role Gates', () => {
    it('rejects an actor lacking the designated stage role', async () => {
      const instance = createMockInstance({ submittedBy: 'user-submitter' });
      db.prisma.approvalInstance.findUnique.mockResolvedValue(instance);

      const wrongRoleContext = createMockUserContext({
        userId: 'user-other',
        isHeadOffice: false,
        roles: [
          {
            roleId: 'role-fo',
            roleName: 'Field Officer',
            roleSlug: 'field-officer',
            priority: 5,
            branchId: null,
          },
        ],
      });

      await expect(
        processStageAction(
          {
            instanceId: 'inst-1',
            actorUserId: 'user-other',
            action: 'approve',
          },
          wrongRoleContext
        )
      ).rejects.toThrow("Action requires role 'branch-manager'. Actor does not have this role.");
    });

    it('rejects an actor without access to the record branch', async () => {
      const instance = createMockInstance({ branchId: 'branch-100', submittedBy: 'user-submitter' });
      db.prisma.approvalInstance.findUnique.mockResolvedValue(instance);

      const wrongBranchContext = createMockUserContext({
        userId: 'user-bm-2',
        isHeadOffice: false,
        roles: [
          {
            roleId: 'role-bm',
            roleName: 'Branch Manager',
            roleSlug: 'branch-manager',
            priority: 10,
            branchId: null,
          },
        ],
        branchAccess: [
          {
            branchId: 'branch-200',
            branchCode: 'BR200',
            branchName: 'Branch 200',
            accessType: 'FULL',
            isPrimary: true,
            isHeadOffice: false,
          },
        ],
      });

      await expect(
        processStageAction(
          {
            instanceId: 'inst-1',
            actorUserId: 'user-bm-2',
            action: 'approve',
          },
          wrongBranchContext
        )
      ).rejects.toThrow("You do not have access to this record's branch.");
    });
  });

  describe('Concurrency Claims', () => {
    it('aborts cleanly when another concurrent request has already claimed the instance', async () => {
      const instance = createMockInstance({ submittedBy: 'user-submitter' });
      db.prisma.approvalInstance.findUnique.mockResolvedValue(instance);
      // Simulate race condition where updateMany returns count: 0 because another transaction committed first
      db.tx.approvalInstance.updateMany.mockResolvedValue({ count: 0 });

      const actorContext = createMockUserContext({
        userId: 'user-reviewer',
        isHeadOffice: true,
        roles: [
          {
            roleId: 'role-admin',
            roleName: 'Admin',
            roleSlug: 'admin',
            priority: 100,
            branchId: null,
          },
        ],
      });

      await expect(
        processStageAction(
          {
            instanceId: 'inst-1',
            actorUserId: 'user-reviewer',
            action: 'approve',
          },
          actorContext
        )
      ).rejects.toThrow('This request was already processed by someone else. Please refresh and try again.');
    });
  });
});
