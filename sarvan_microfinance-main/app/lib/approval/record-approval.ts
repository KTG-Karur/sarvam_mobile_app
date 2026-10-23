// ============================================================
// RECORD APPROVAL — glue between an HR record and the generic engine
// app/lib/approval/record-approval.ts
//
// Leave, Permission, Promotion and Exit each keep their own record + status
// column, but the approval CHAIN (how many stages, which roles) comes from the
// admin-configured workflow for their module — same as Onboarding/Transfer.
// The engine links to a record through ApprovalInstance.recordType/recordId,
// so these records need no extra column.
//
// A record's own status stays PENDING while it moves through intermediate
// stages; the caller applies the record's real side effect (balance
// deduction, letter, deactivation…) only when the last stage approves.
// ============================================================

import type { ApprovalStatus } from '@prisma/client';
import { prisma } from '@/app/lib/prisma';
import type { UserContext } from '@/app/lib/permissions/types';
import { startApprovalWorkflow, processStageAction } from './engine';

const OPEN_STATUSES: ApprovalStatus[] = ['PENDING', 'IN_PROGRESS'];

export interface ApprovalRecordRef {
  moduleSlug: string;
  recordType: string;
  recordId: string;
  /** Branch of the employee the record is about; '' = not branch-scoped. */
  branchId: string;
  submittedByUserId: string;
}

export interface ApprovalAdvanceResult {
  newStatus: string;
  nextStage: string | null;
  /** True when this request had already cleared every stage earlier but its side effect never landed. */
  resumed: boolean;
}

/** Starts the module's configured workflow for a freshly-created record. */
export async function startRecordApproval(ref: ApprovalRecordRef): Promise<string> {
  const { instanceId } = await startApprovalWorkflow({
    moduleSlug: ref.moduleSlug,
    recordType: ref.recordType,
    recordId: ref.recordId,
    branchId: ref.branchId,
    submittedByUserId: ref.submittedByUserId,
  });
  return instanceId;
}

/**
 * Applies an approve/reject action to the record's current stage.
 *
 * - No instance yet (a request created before this record type used the
 *   engine): the module's workflow is started now, so already-pending
 *   requests are picked up instead of being stranded.
 * - Instance already fully APPROVED but the caller is approving again: the
 *   earlier attempt cleared the chain and then failed while applying the
 *   record's side effect. Returned as a resumed APPROVED so the caller can
 *   re-run just the side effect instead of restarting approval.
 */
export async function advanceRecordApproval(
  ref: ApprovalRecordRef,
  ctx: UserContext,
  action: 'approve' | 'reject',
  remarks?: string
): Promise<ApprovalAdvanceResult> {
  const latest = await prisma.approvalInstance.findFirst({
    where: { recordType: ref.recordType, recordId: ref.recordId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true },
  });

  let instanceId: string;
  if (!latest) {
    instanceId = await startRecordApproval(ref);
  } else if (OPEN_STATUSES.includes(latest.status)) {
    instanceId = latest.id;
  } else if (latest.status === 'APPROVED' && action === 'approve') {
    return { newStatus: 'APPROVED', nextStage: null, resumed: true };
  } else {
    throw new Error(`This request's approval is already ${latest.status.toLowerCase()}.`);
  }

  const outcome = await processStageAction(
    { instanceId, actorUserId: ctx.userId, action, remarks },
    ctx
  );
  return { ...outcome, resumed: false };
}

/** Closes any open approval for a record the requester (or an admin) cancelled. */
export async function cancelRecordApproval(
  recordType: string,
  recordId: string,
  actorUserId: string,
  remarks?: string
): Promise<void> {
  const open = await prisma.approvalInstance.findMany({
    where: { recordType, recordId, status: { in: OPEN_STATUSES } },
    select: { id: true, currentStageId: true },
  });
  if (open.length === 0) return;

  const now = new Date();
  await prisma.$transaction([
    prisma.approvalInstance.updateMany({
      where: { id: { in: open.map((i) => i.id) } },
      data: { status: 'CANCELLED', completedAt: now },
    }),
    ...open.map((i) =>
      prisma.approvalLog.create({
        data: {
          instanceId: i.id,
          actedBy: actorUserId,
          action: 'cancelled',
          stageId: i.currentStageId,
          remarks: remarks ?? 'Request cancelled',
        },
      })
    ),
  ]);
}

// ─────────────────────────────────────────────
// LIST DECORATION — "Awaiting <stage>" + can this viewer act on it?
// ─────────────────────────────────────────────
export interface RecordApprovalInfo {
  stageName: string;
  approverRoleSlug: string;
  stageNumber: number;
  totalStages: number;
  /** Whether the requesting viewer may approve/reject the current stage. */
  canAct: boolean;
}

function viewerCanAct(ctx: UserContext, approverRoleSlug: string, branchId: string | null): boolean {
  const isAdmin = ctx.roles.some((r) => r.roleSlug === 'admin');
  const hasRole = isAdmin || ctx.roles.some((r) => r.roleSlug === approverRoleSlug);
  if (!hasRole) return false;
  // Same branch rule the engine enforces in processStageAction.
  if (!branchId) return true;
  return ctx.isHeadOffice || ctx.branchAccess.some((ba) => ba.branchId === branchId);
}

/**
 * For each still-pending record, which stage it is waiting on. Records with no
 * instance yet (created before this module used the engine) are described by
 * the module's default workflow, which is where they'd start once acted on.
 */
export async function describePendingApprovals(
  moduleSlug: string,
  recordType: string,
  records: Array<{ id: string; branchId: string | null }>,
  ctx: UserContext
): Promise<Map<string, RecordApprovalInfo>> {
  const result = new Map<string, RecordApprovalInfo>();
  if (records.length === 0) return result;

  const instances = await prisma.approvalInstance.findMany({
    where: {
      recordType,
      recordId: { in: records.map((r) => r.id) },
      status: { in: OPEN_STATUSES },
    },
    orderBy: { createdAt: 'asc' },
    include: { workflow: { include: { stages: { orderBy: { stageOrder: 'asc' } } } } },
  });
  // orderBy asc + overwrite = the newest open instance per record wins.
  const byRecord = new Map<string, (typeof instances)[number]>();
  for (const inst of instances) byRecord.set(inst.recordId, inst);

  let fallbackStages: Awaited<ReturnType<typeof loadDefaultStages>> | undefined;

  for (const rec of records) {
    const inst = byRecord.get(rec.id);
    let stages;
    let currentStageId: string | null;
    let branchId = rec.branchId;
    if (inst) {
      stages = inst.workflow.stages;
      currentStageId = inst.currentStageId;
      branchId = inst.branchId || rec.branchId;
    } else {
      fallbackStages ??= await loadDefaultStages(moduleSlug);
      stages = fallbackStages;
      currentStageId = stages[0]?.id ?? null;
    }
    const current = stages.find((s) => s.id === currentStageId);
    if (!current) continue;
    result.set(rec.id, {
      stageName: current.name,
      approverRoleSlug: current.approverRoleSlug,
      stageNumber: current.stageOrder,
      totalStages: stages.length,
      canAct: viewerCanAct(ctx, current.approverRoleSlug, branchId),
    });
  }
  return result;
}

async function loadDefaultStages(moduleSlug: string) {
  const workflows = await prisma.approvalWorkflow.findMany({
    where: { isActive: true, module: { slug: moduleSlug } },
    include: { stages: { orderBy: { stageOrder: 'asc' } } },
  });
  const wf = workflows.find((w) => w.isDefault) ?? workflows[0];
  return wf?.stages ?? [];
}

/**
 * Maps an engine error to an HTTP status so role/branch denials and
 * already-processed races aren't reported as 500s. Anything else gets `fallback`.
 */
export function approvalErrorStatus(message: string, fallback = 500): number {
  if (message.startsWith('Action requires role') || message.startsWith('You do not have access')) return 403;
  if (message.includes('already ') || message.includes('cannot process')) return 409;
  return fallback;
}
