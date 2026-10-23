// ============================================================
// APPROVAL WORKFLOW MANAGEMENT API — single workflow
// app/api/admin/approval-workflows/[id]/route.ts
//
// Fills the gap found while planning HR Onboarding: the generic
// ApprovalWorkflow/ApprovalStage engine (app/lib/approval/engine.ts) has been
// usable since Employee Transfer shipped, but there was never an API to
// edit/reorder/remove stages on an existing workflow — only create-in-one-shot
// (see the sibling route.ts). This route is what
// components/hr/ApprovalWorkflowConfigPage.tsx calls to make that dynamic.
// ============================================================

import { NextRequest } from 'next/server';
import { z } from 'zod';
import { ApprovalStatus } from '@prisma/client';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse } from '@/app/lib/api-utils';
import { requirePermission, isUserContext } from '@/app/lib/permissions/guards';

export async function OPTIONS() {
  return handleCorsPreflight();
}

const StageSchema = z.object({
  // Present when editing an existing stage; absent for a newly added one.
  id: z.string().optional(),
  name: z.string().min(1),
  stageOrder: z.number().int().min(1),
  approverRoleSlug: z.string().min(1),
  // Only actions the engine understands, and every stage must allow 'approve' —
  // a stage without it can never let a request move forward, stranding
  // everything submitted to the module.
  allowedActions: z.array(z.enum(['approve', 'reject', 'send_back', 'request_info'])).min(1)
    .refine((actions) => actions.includes('approve'), { message: "Every stage must allow 'approve'" }),
  slaHours: z.number().int().positive().optional().nullable(),
  isOptional: z.boolean().optional(),
});

const UpdateWorkflowSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  stages: z.array(StageSchema).min(1),
});

// Statuses that mean "a request is actively moving through this workflow right
// now" — editing stage order/roles underneath one of these could corrupt an
// in-progress approval, so the whole edit is blocked while any exist.
const NON_TERMINAL_STATUSES: ApprovalStatus[] = ['PENDING', 'IN_PROGRESS', 'SENT_BACK'];

function isForeignKeyViolation(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === 'P2003' || code === 'P2014';
}

// GET /api/admin/approval-workflows/[id]
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission(request, 'admin', 'view');
  if (!isUserContext(ctx)) return ctx;

  try {
    const { id } = await params;
    const workflow = await prisma.approvalWorkflow.findUnique({
      where: { id },
      include: {
        module: { select: { name: true, slug: true } },
        stages: { orderBy: { stageOrder: 'asc' } },
        _count: { select: { instances: true } },
      },
    });
    if (!workflow) return errorResponse('Workflow not found', 404);

    const inFlightCount = await prisma.approvalInstance.count({
      where: { workflowId: id, status: { in: NON_TERMINAL_STATUSES } },
    });

    return successResponse({ workflow, inFlightCount }, 'Workflow fetched successfully');
  } catch (error: any) {
    console.error('Error fetching approval workflow:', error);
    return errorResponse(error.message || 'Failed to fetch workflow', 500);
  }
}

// PUT /api/admin/approval-workflows/[id] — add/remove/reorder stages, reassign
// roles, any count, no hardcoded first/last stage.
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission(request, 'admin', 'edit');
  if (!isUserContext(ctx)) return ctx;

  try {
    const { id } = await params;
    const body = await request.json();
    const data = UpdateWorkflowSchema.parse(body);

    const existing = await prisma.approvalWorkflow.findUnique({ where: { id }, include: { stages: true } });
    if (!existing) return errorResponse('Workflow not found', 404);

    // With no active workflow, every new request for the module fails outright
    // ("No active approval workflow found") — refuse to switch off the last one.
    if (data.isActive === false && existing.isActive) {
      const otherActive = await prisma.approvalWorkflow.count({
        where: { moduleId: existing.moduleId, isActive: true, id: { not: id } },
      });
      if (otherActive === 0) {
        return errorResponse('This is the only active workflow for its module — activate another one before deactivating it, or new requests could not be submitted.', 409);
      }
    }

    const inFlightCount = await prisma.approvalInstance.count({
      where: { workflowId: id, status: { in: NON_TERMINAL_STATUSES } },
    });
    if (inFlightCount > 0) {
      return errorResponse(
        `Cannot edit this workflow — ${inFlightCount} request(s) are currently in progress against it. Wait until they complete, or configure a new workflow instead.`,
        409
      );
    }

    // Stage order must be a contiguous 1..N sequence — no gaps, no
    // duplicates, and no implicit "first"/"last" stage; every position is
    // just a number.
    const orders = data.stages.map((s) => s.stageOrder).slice().sort((a, b) => a - b);
    const expected = orders.map((_, i) => i + 1);
    if (JSON.stringify(orders) !== JSON.stringify(expected)) {
      return errorResponse('Stage order must run 1..N with no gaps or duplicates.', 400);
    }

    const roleSlugs = [...new Set(data.stages.map((s) => s.approverRoleSlug))];
    const knownRoles = await prisma.role.findMany({ where: { slug: { in: roleSlugs } }, select: { slug: true } });
    const knownSlugs = new Set(knownRoles.map((r) => r.slug));
    const unknownSlugs = roleSlugs.filter((slug) => !knownSlugs.has(slug));
    if (unknownSlugs.length > 0) {
      return errorResponse(`Unknown role(s): ${unknownSlugs.join(', ')}`, 400);
    }

    const existingIds = new Set(existing.stages.map((s) => s.id));
    const incomingIds = new Set(data.stages.filter((s) => s.id).map((s) => s.id as string));
    const idsToRemove = [...existingIds].filter((sid) => !incomingIds.has(sid));

    // A stage any request has ever passed through keeps its history rows
    // (ApprovalInstanceStage — who acted, when, remarks). Those rows are the
    // approval audit trail, so they are never deleted to make room for a
    // stage removal: the removal is refused instead.
    if (idsToRemove.length > 0) {
      const usedStages = await prisma.approvalInstanceStage.findMany({
        where: { stageId: { in: idsToRemove } },
        select: { stageId: true },
        distinct: ['stageId'],
      });
      if (usedStages.length > 0) {
        const names = usedStages
          .map((u) => existing.stages.find((s) => s.id === u.stageId)?.name ?? u.stageId)
          .map((n) => `"${n}"`)
          .join(', ');
        return errorResponse(
          `Stage ${names} has request history and can't be removed — edit its name or approver role instead.`,
          409
        );
      }
    }

    const workflow = await prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.approvalWorkflow.updateMany({
          where: { moduleId: existing.moduleId, isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }

      await tx.approvalWorkflow.update({
        where: { id },
        data: {
          name: data.name,
          description: data.description,
          isDefault: data.isDefault,
          isActive: data.isActive,
        },
      });

      // Stages the admin dropped from the list — only ones with no request
      // history reach here (checked above). The DB's own foreign key
      // (ApprovalInstanceStage.stageId has no cascade) stays as a backstop
      // for a history row written between that check and this delete.
      for (const stageId of idsToRemove) {
        try {
          await tx.approvalStage.delete({ where: { id: stageId } });
        } catch (err) {
          if (isForeignKeyViolation(err)) {
            const stage = existing.stages.find((s) => s.id === stageId);
            throw new Error(
              `Stage "${stage?.name ?? stageId}" has request history and can't be removed — edit its name or approver role instead.`
            );
          }
          throw err;
        }
      }

      for (const stage of data.stages) {
        const stageData = {
          name: stage.name,
          stageOrder: stage.stageOrder,
          approverRoleSlug: stage.approverRoleSlug,
          allowedActions: stage.allowedActions,
          slaHours: stage.slaHours ?? null,
          isOptional: stage.isOptional ?? false,
        };
        if (stage.id && existingIds.has(stage.id)) {
          await tx.approvalStage.update({ where: { id: stage.id }, data: stageData });
        } else {
          await tx.approvalStage.create({ data: { workflowId: id, ...stageData } });
        }
      }

      return tx.approvalWorkflow.findUniqueOrThrow({
        where: { id },
        include: {
          module: { select: { name: true, slug: true } },
          stages: { orderBy: { stageOrder: 'asc' } },
        },
      });
    });

    return successResponse({ workflow }, 'Workflow updated successfully');
  } catch (error: any) {
    if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
    console.error('Error updating approval workflow:', error);
    return errorResponse(error.message || 'Failed to update workflow', 409);
  }
}

// DELETE /api/admin/approval-workflows/[id] — hard-delete only if it has never
// been used; otherwise soft-delete (isActive: false) to preserve history.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission(request, 'admin', 'delete');
  if (!isUserContext(ctx)) return ctx;

  try {
    const { id } = await params;
    const existing = await prisma.approvalWorkflow.findUnique({
      where: { id },
      include: { _count: { select: { instances: true } } },
    });
    if (!existing) return errorResponse('Workflow not found', 404);

    if (existing.isActive) {
      const otherActive = await prisma.approvalWorkflow.count({
        where: { moduleId: existing.moduleId, isActive: true, id: { not: id } },
      });
      if (otherActive === 0) {
        return errorResponse('This is the only active workflow for its module — create or activate another one first, or new requests could not be submitted.', 409);
      }
    }

    if (existing._count.instances === 0) {
      await prisma.approvalWorkflow.delete({ where: { id } });
      return successResponse(null, 'Workflow deleted');
    }

    await prisma.approvalWorkflow.update({ where: { id }, data: { isActive: false } });
    return successResponse(null, 'This workflow has request history, so it was deactivated instead of deleted.');
  } catch (error: any) {
    console.error('Error deleting approval workflow:', error);
    return errorResponse(error.message || 'Failed to delete workflow', 500);
  }
}
