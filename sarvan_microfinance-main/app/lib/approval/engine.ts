// ============================================================
// APPROVAL WORKFLOW ENGINE
// app/lib/approval/engine.ts
//
// Handles:
//   - Starting an approval workflow for a record
//   - Processing stage approvals/rejections
//   - Escalations and SLA
//   - Rollback and reopen
//   - Audit logging
// ============================================================

import type { Prisma } from '@prisma/client';
import { prisma } from '@/app/lib/prisma';
import type { UserContext } from '@/app/lib/permissions/types';
import { ensureDefaultWorkflow } from './ensure-defaults';

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────
export interface StartWorkflowOptions {
  moduleSlug: string;
  recordType: string;
  recordId: string;
  branchId: string;
  submittedByUserId: string;
  metadata?: Record<string, unknown>;
  // Optional conditions to select the right workflow
  conditions?: Record<string, unknown>;
  skipApproval?: boolean;
  skippedReason?: string;
}

export interface ProcessStageOptions {
  instanceId: string;
  actorUserId: string;
  action: 'approve' | 'reject' | 'send_back' | 'request_info';
  remarks?: string;
  ipAddress?: string;
}

export interface WorkflowStatus {
  instance: {
    id: string;
    status: string;
    currentStageId: string | null;
    recordType: string;
    recordId: string;
  };
  stages: Array<{
    stageId: string;
    stageName: string;
    stageOrder: number;
    approverRoleSlug: string;
    status: string;
    actedBy: string | null;
    actedAt: Date | null;
    remarks: string | null;
  }>;
  logs: Array<{
    action: string;
    actedBy: string;
    stageName: string | null;
    remarks: string | null;
    createdAt: Date;
  }>;
}

// ─────────────────────────────────────────────
// START WORKFLOW
// Creates a new approval instance for a record
// ─────────────────────────────────────────────
export async function startApprovalWorkflow(
  options: StartWorkflowOptions
): Promise<{ instanceId: string; workflowName: string }> {
  const { moduleSlug, recordType, recordId, branchId, submittedByUserId, metadata } =
    options;

  // 1. Find module (with its active workflows)
  const loadModule = () =>
    prisma.module.findUnique({
      where: { slug: moduleSlug },
      include: {
        approvalWorkflows: {
          where: { isActive: true },
          include: { stages: { orderBy: { stageOrder: 'asc' } } },
        },
      },
    });

  let loaded = await loadModule();

  // A database that was never seeded for this module has no Module row or no
  // workflow yet — create the standard default instead of failing the request.
  if (!loaded || loaded.approvalWorkflows.length === 0) {
    if (await ensureDefaultWorkflow(moduleSlug)) loaded = await loadModule();
  }

  const approvalModule = loaded;
  if (!approvalModule) throw new Error(`Module '${moduleSlug}' not found`);

  // 2. Select appropriate workflow
  // Default: pick the one marked isDefault, or first active
  const workflow =
    approvalModule.approvalWorkflows.find((w) => w.isDefault) ||
    approvalModule.approvalWorkflows[0];

  if (!workflow) {
    throw new Error(`No active approval workflow found for module '${moduleSlug}'`);
  }

  // Skip-approval short circuit:
  // When a module/caller flags skip approval, instantly create an APPROVED instance
  // with an auto_approved audit log and zero stage rows.
  const shouldSkip = Boolean(
    options.skipApproval ||
    options.conditions?.skipApproval ||
    options.metadata?.skipApproval
  );
  const skippedReason =
    options.skippedReason ||
    (options.conditions?.skippedReason as string | undefined) ||
    (options.metadata?.skippedReason as string | undefined) ||
    'Approval skipped for this module';

  if (shouldSkip) {
    const now = new Date();
    const instance = await prisma.$transaction(async (tx) => {
      const inst = await tx.approvalInstance.create({
        data: {
          workflowId: workflow.id,
          recordType,
          recordId,
          branchId,
          submittedBy: submittedByUserId,
          status: 'APPROVED',
          currentStageId: null,
          completedAt: now,
          ...(metadata ? { metadata: { ...(metadata as Record<string, unknown>), skippedReason } as Prisma.InputJsonValue } : { metadata: { skippedReason } }),
        },
      });

      // Create auto_approved audit log — zero stage rows created
      await tx.approvalLog.create({
        data: {
          instanceId: inst.id,
          actedBy: submittedByUserId,
          action: 'auto_approved',
          stageName: null,
          remarks: skippedReason,
          ...(metadata ? { metadata: { ...(metadata as Record<string, unknown>), skippedReason } as Prisma.InputJsonValue } : { metadata: { skippedReason } }),
        },
      });

      return inst;
    });

    return { instanceId: instance.id, workflowName: workflow.name };
  }

  if (workflow.stages.length === 0) {
    throw new Error(`Workflow '${workflow.name}' has no stages configured`);
  }

  // 3. Create instance and stage instances in transaction
  const firstStage = workflow.stages[0];

  const instance = await prisma.$transaction(async (tx) => {
    const inst = await tx.approvalInstance.create({
      data: {
        workflowId: workflow.id,
        recordType,
        recordId,
        branchId,
        submittedBy: submittedByUserId,
        status: 'PENDING',
        currentStageId: firstStage.id,
        ...(metadata ? { metadata: metadata as Prisma.InputJsonValue } : {}),
      },
    });

    // Create stage instances for all stages
    await tx.approvalInstanceStage.createMany({
      data: workflow.stages.map((stage) => ({
        instanceId: inst.id,
        stageId: stage.id,
        status: stage.id === firstStage.id ? 'PENDING' : 'PENDING',
      })),
    });

    // Create initial log
    await tx.approvalLog.create({
      data: {
        instanceId: inst.id,
        actedBy: submittedByUserId,
        action: 'submitted',
        stageName: firstStage.name,
        remarks: 'Workflow initiated',
        ...(metadata ? { metadata: metadata as Prisma.InputJsonValue } : {}),
      },
    });

    return inst;
  });

  return { instanceId: instance.id, workflowName: workflow.name };
}

// ─────────────────────────────────────────────
// PROCESS STAGE ACTION
// Actor takes action on the current stage
// ─────────────────────────────────────────────
/**
 * Rollback companion to startApprovalWorkflow. A caller that creates its
 * record first and deletes it again when anything after startApprovalWorkflow
 * fails must also close the approval instance — the engine has already
 * committed it, and an orphaned PENDING instance (pointing at a deleted
 * record) sits in no one's queue yet still locks the workflow against edits
 * on Approval Settings. Cancelled rather than deleted so the audit log stays.
 * Looks up by record, not instanceId, since the failure may happen before the
 * caller ever received the id. Never throws — the caller rethrows its own error.
 */
export async function cancelApprovalForRecord(
  recordType: string,
  recordId: string,
  actedByUserId: string,
  reason = 'Request creation failed — record rolled back'
): Promise<void> {
  try {
    const open = await prisma.approvalInstance.findMany({
      where: { recordType, recordId, status: { in: ['PENDING', 'IN_PROGRESS', 'SENT_BACK'] } },
      select: { id: true },
    });
    if (open.length === 0) return;
    const now = new Date();
    await prisma.$transaction([
      prisma.approvalInstance.updateMany({
        where: { id: { in: open.map((i) => i.id) } },
        data: { status: 'CANCELLED', completedAt: now, currentStageId: null, rejectionReason: reason },
      }),
      prisma.approvalLog.createMany({
        data: open.map((i) => ({ instanceId: i.id, actedBy: actedByUserId, action: 'cancelled', stageName: null, remarks: reason })),
      }),
    ]);
  } catch (err) {
    console.error(`Failed to cancel approval instance for ${recordType}:${recordId}:`, err);
  }
}

export async function processStageAction(
  options: ProcessStageOptions,
  actorContext: UserContext
): Promise<{ newStatus: string; nextStage: string | null }> {
  const { instanceId, actorUserId, action, remarks, ipAddress } = options;

  // 1. Load current instance with workflow
  const instance = await prisma.approvalInstance.findUnique({
    where: { id: instanceId },
    include: {
      workflow: {
        include: {
          stages: { orderBy: { stageOrder: 'asc' } },
        },
      },
      stageInstances: {
        include: { stage: true },
      },
    },
  });

  if (!instance) throw new Error('Approval instance not found');
  if (instance.status !== 'PENDING' && instance.status !== 'IN_PROGRESS') {
    throw new Error(`Instance is in '${instance.status}' state, cannot process`);
  }
  if (!instance.currentStageId) throw new Error('No current stage found');

  // 2. Find current stage
  const currentStage = instance.workflow.stages.find(
    (s) => s.id === instance.currentStageId
  );
  if (!currentStage) throw new Error('Current stage not found in workflow');

  // 3. Verify actor has the required role for this stage — ADMIN is a
  // system-wide override (the same unconditional-access convention already
  // applied everywhere else, e.g. resolvePageAuthorization() and the RBAC
  // seed's unconditional admin permission grant) and may act on whichever
  // stage is CURRENTLY pending regardless of its designated
  // approverRoleSlug. This does not let admin skip ahead to a future stage —
  // instance.currentStageId still gates which single stage is actionable,
  // so sequential ordering is unaffected.
  const isAdmin = actorContext.roles.some((r) => r.roleSlug === 'admin');

  // Maker-checker rule (engine-wide, unconditional):
  // An actor cannot act on their own submission unless they are an admin.
  if (actorUserId === instance.submittedBy && !isAdmin) {
    throw new Error('Self-approval is not allowed');
  }

  const hasRole =
    isAdmin ||
    actorContext.roles.some((r) => r.roleSlug === currentStage.approverRoleSlug);
  if (!hasRole) {
    throw new Error(
      `Action requires role '${currentStage.approverRoleSlug}'. Actor does not have this role.`
    );
  }

  // 3b. Verify actor is permitted to act on this record's branch — role-slug
  // match alone (above) says nothing about *which* branch's records the actor
  // may touch, so an approver holding the stage's role but scoped to a
  // different branch could otherwise approve/reject any branch's instance.
  // Only enforced when the instance actually carries a branchId — a module
  // that starts a workflow without one is treated as not branch-scoped rather
  // than silently locking out every actor.
  if (instance.branchId) {
    const hasBranchAccess =
      actorContext.isHeadOffice ||
      actorContext.branchAccess.some((ba) => ba.branchId === instance.branchId);
    if (!hasBranchAccess) {
      throw new Error('You do not have access to this record\'s branch.');
    }
  }

  // 4. Verify action is allowed at this stage
  if (!currentStage.allowedActions.includes(action)) {
    throw new Error(`Action '${action}' is not allowed at stage '${currentStage.name}'`);
  }

  // 5. Process action in transaction
  const result = await prisma.$transaction(async (tx) => {
    const now = new Date();

    // Atomically claim this instance before touching anything: the initial
    // findUnique above ran outside this transaction, so under concurrent
    // requests (a double-click, a retried request, or genuine high load)
    // two callers could both pass the status/stage checks and both reach
    // here. This conditional update only succeeds for whichever transaction
    // commits first — Postgres serializes concurrent writers on the same
    // row, and the loser's WHERE clause no longer matches once the winner's
    // status change is visible, so `claimed.count` comes back 0 and it
    // aborts cleanly instead of double-processing (e.g. provisioning two
    // User accounts for one onboarding request).
    const claimed = await tx.approvalInstance.updateMany({
      where: { id: instanceId, status: instance.status, currentStageId: instance.currentStageId },
      data: { updatedAt: now },
    });
    if (claimed.count === 0) {
      throw new Error('This request was already processed by someone else. Please refresh and try again.');
    }

    // Update current stage instance
    await tx.approvalInstanceStage.update({
      where: { instanceId_stageId: { instanceId, stageId: currentStage.id } },
      data: {
        status: action === 'approve' ? 'APPROVED' : action === 'reject' ? 'REJECTED' : 'SENT_BACK',
        actedBy: actorUserId,
        actedAt: now,
        action,
        remarks,
      },
    });

    let newStatus: string;
    let nextStageId: string | null = null;
    let nextStageName: string | null = null;

    if (action === 'approve') {
      // Find next stage
      const nextStage = instance.workflow.stages.find(
        (s) => s.stageOrder === currentStage.stageOrder + 1
      );

      if (nextStage) {
        // Move to next stage
        newStatus = 'IN_PROGRESS';
        nextStageId = nextStage.id;
        nextStageName = nextStage.name;

        await tx.approvalInstance.update({
          where: { id: instanceId },
          data: { status: 'IN_PROGRESS', currentStageId: nextStageId },
        });
      } else {
        // All stages complete
        newStatus = 'APPROVED';
        await tx.approvalInstance.update({
          where: { id: instanceId },
          data: {
            status: 'APPROVED',
            currentStageId: null,
            completedAt: now,
          },
        });
      }
    } else if (action === 'reject') {
      newStatus = 'REJECTED';
      await tx.approvalInstance.update({
        where: { id: instanceId },
        data: {
          status: 'REJECTED',
          completedAt: now,
          rejectionReason: remarks,
        },
      });
    } else {
      // send_back / request_info — go back to submitter
      newStatus = 'SENT_BACK';
      await tx.approvalInstance.update({
        where: { id: instanceId },
        data: { status: 'SENT_BACK' },
      });
    }

    // Create audit log
    await tx.approvalLog.create({
      data: {
        instanceId,
        actedBy: actorUserId,
        action,
        stageId: currentStage.id,
        stageName: currentStage.name,
        remarks,
        ipAddress,
        metadata: { nextStage: nextStageName },
      },
    });

    return { newStatus, nextStage: nextStageName };
  });

  return result;
}

// ─────────────────────────────────────────────
// GET WORKFLOW STATUS
// ─────────────────────────────────────────────
export async function getWorkflowStatus(instanceId: string): Promise<WorkflowStatus> {
  const instance = await prisma.approvalInstance.findUnique({
    where: { id: instanceId },
    include: {
      stageInstances: {
        include: { stage: true },
        orderBy: { stage: { stageOrder: 'asc' } },
      },
      logs: { orderBy: { createdAt: 'desc' }, take: 20 },
    },
  });

  if (!instance) throw new Error('Instance not found');

  return {
    instance: {
      id: instance.id,
      status: instance.status,
      currentStageId: instance.currentStageId,
      recordType: instance.recordType,
      recordId: instance.recordId,
    },
    stages: instance.stageInstances.map((si) => ({
      stageId: si.stageId,
      stageName: si.stage.name,
      stageOrder: si.stage.stageOrder,
      approverRoleSlug: si.stage.approverRoleSlug,
      status: si.status,
      actedBy: si.actedBy,
      actedAt: si.actedAt,
      remarks: si.remarks,
    })),
    logs: instance.logs.map((l) => ({
      action: l.action,
      actedBy: l.actedBy,
      stageName: l.stageName,
      remarks: l.remarks,
      createdAt: l.createdAt,
    })),
  };
}

// ─────────────────────────────────────────────
// GET PENDING QUEUE FOR USER
// Returns all instances waiting for this user's role
// ─────────────────────────────────────────────
export async function getPendingQueue(
  userContext: UserContext
): Promise<Array<{ instanceId: string; recordType: string; recordId: string; stageName: string; submittedAt: Date }>> {
  const userRoleSlugs = userContext.roles.map((r) => r.roleSlug);
  const userBranchIds = userContext.branchAccess.map((ba) => ba.branchId);

  const instances = await prisma.approvalInstance.findMany({
    where: {
      status: { in: ['PENDING', 'IN_PROGRESS'] },
      branchId: { in: userBranchIds },
      workflow: {
        stages: {
          some: {
            approverRoleSlug: { in: userRoleSlugs },
          },
        },
      },
    },
    include: {
      workflow: {
        include: {
          stages: {
            where: { approverRoleSlug: { in: userRoleSlugs } },
          },
        },
      },
    },
    orderBy: { submittedAt: 'asc' },
    take: 100,
  });

  // Filter: only instances where the current stage matches user's role
  return instances
    .filter((inst) => {
      if (!inst.currentStageId) return false;
      return inst.workflow.stages.some((s) => s.id === inst.currentStageId);
    })
    .map((inst) => {
      const currentStage = inst.workflow.stages.find(
        (s) => s.id === inst.currentStageId
      );
      return {
        instanceId: inst.id,
        recordType: inst.recordType,
        recordId: inst.recordId,
        stageName: currentStage?.name ?? 'Unknown Stage',
        submittedAt: inst.submittedAt,
      };
    });
}

// ─────────────────────────────────────────────
// REOPEN WORKFLOW
// Resets a REJECTED/SENT_BACK instance
// ─────────────────────────────────────────────
export async function reopenWorkflow(
  instanceId: string,
  reopenedByUserId: string,
  remarks?: string
): Promise<void> {
  const instance = await prisma.approvalInstance.findUnique({
    where: { id: instanceId },
    include: {
      workflow: { include: { stages: { orderBy: { stageOrder: 'asc' } } } },
    },
  });

  if (!instance) throw new Error('Instance not found');
  if (!['REJECTED', 'SENT_BACK'].includes(instance.status)) {
    throw new Error(`Cannot reopen instance with status '${instance.status}'`);
  }

  const firstStage = instance.workflow.stages[0];

  await prisma.$transaction(async (tx) => {
    // Reset instance
    await tx.approvalInstance.update({
      where: { id: instanceId },
      data: {
        status: 'PENDING',
        currentStageId: firstStage.id,
        completedAt: null,
        rejectionReason: null,
      },
    });

    // Reset all stage instances
    await tx.approvalInstanceStage.updateMany({
      where: { instanceId },
      data: {
        status: 'PENDING',
        actedBy: null,
        actedAt: null,
        action: null,
        remarks: null,
      },
    });

    // Log
    await tx.approvalLog.create({
      data: {
        instanceId,
        actedBy: reopenedByUserId,
        action: 'reopened',
        remarks: remarks ?? 'Workflow reopened',
      },
    });
  });
}
