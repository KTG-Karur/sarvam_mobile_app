// ============================================================
// APPROVAL WORKFLOW MANAGEMENT API
// app/api/admin/approval-workflows/route.ts
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/prisma';
import { requirePermission, isUserContext } from '@/app/lib/permissions/guards';
import { getDefaultWorkflowConfig, ensureWorkflowModule } from '@/app/lib/approval/ensure-defaults';

const StageSchema = z.object({
  name: z.string(),
  stageOrder: z.number().int().min(1),
  approverRoleSlug: z.string(),
  allowedActions: z.array(z.enum(['approve', 'reject', 'send_back', 'request_info'])).min(1)
    .refine((actions) => actions.includes('approve'), { message: "Every stage must allow 'approve'" }),
  slaHours: z.number().optional(),
  isOptional: z.boolean().optional(),
});

const CreateWorkflowSchema = z.object({
  moduleSlug: z.string(),
  name: z.string(),
  description: z.string().optional(),
  isDefault: z.boolean().optional(),
  conditions: z.any().optional(),
  stages: z.array(StageSchema).min(1),
});

// GET — List all workflows
export async function GET(request: NextRequest) {
  const result = await requirePermission(request, 'admin', 'view');
  if (!isUserContext(result)) return result;

  const workflows = await prisma.approvalWorkflow.findMany({
    include: {
      module: { select: { name: true, slug: true } },
      stages: { orderBy: { stageOrder: 'asc' } },
      _count: { select: { instances: true } },
    },
    orderBy: { module: { name: 'asc' } },
  });

  return NextResponse.json({ success: true, workflows });
}

// POST — Create workflow with stages
export async function POST(request: NextRequest) {
  const result = await requirePermission(request, 'admin', 'create');
  if (!isUserContext(result)) return result;

  const body = await request.json();
  const parsed = CreateWorkflowSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  let workflowModule = await prisma.module.findUnique({
    where: { slug: parsed.data.moduleSlug },
  });

  // A standard approval module this database doesn't have yet (e.g. one added
  // after it was last seeded) is created on demand; anything else is a 404.
  if (!workflowModule) {
    const defaultConfig = getDefaultWorkflowConfig(parsed.data.moduleSlug);
    if (defaultConfig) workflowModule = await ensureWorkflowModule(defaultConfig);
  }

  if (!workflowModule) {
    return NextResponse.json(
      { success: false, error: `Module '${parsed.data.moduleSlug}' not found` },
      { status: 404 }
    );
  }

  const moduleId = workflowModule.id;

  // Same rules the update route enforces: contiguous 1..N order, known roles.
  const orders = parsed.data.stages.map((s) => s.stageOrder).slice().sort((a, b) => a - b);
  if (JSON.stringify(orders) !== JSON.stringify(orders.map((_, i) => i + 1))) {
    return NextResponse.json({ success: false, error: 'Stage order must run 1..N with no gaps or duplicates.' }, { status: 400 });
  }
  const roleSlugs = [...new Set(parsed.data.stages.map((s) => s.approverRoleSlug))];
  const knownRoles = await prisma.role.findMany({ where: { slug: { in: roleSlugs } }, select: { slug: true } });
  const knownSlugs = new Set(knownRoles.map((r) => r.slug));
  const unknownSlugs = roleSlugs.filter((slug) => !knownSlugs.has(slug));
  if (unknownSlugs.length > 0) {
    return NextResponse.json({ success: false, error: `Unknown role(s): ${unknownSlugs.join(', ')}` }, { status: 400 });
  }

  const workflow = await prisma.$transaction(async (tx) => {
    // If this is marked as default, unset other defaults for this module
    if (parsed.data.isDefault) {
      await tx.approvalWorkflow.updateMany({
        where: { moduleId, isDefault: true },
        data: { isDefault: false },
      });
    }

    const wf = await tx.approvalWorkflow.create({
      data: {
        moduleId,
        name: parsed.data.name,
        description: parsed.data.description,
        isDefault: parsed.data.isDefault ?? false,
        conditions: parsed.data.conditions,
      },
    });

    await tx.approvalStage.createMany({
      data: parsed.data.stages.map((stage) => ({
        workflowId: wf.id,
        name: stage.name,
        stageOrder: stage.stageOrder,
        approverRoleSlug: stage.approverRoleSlug,
        allowedActions: stage.allowedActions,
        slaHours: stage.slaHours,
        isOptional: stage.isOptional ?? false,
      })),
    });

    return wf;
  });

  return NextResponse.json(
    { success: true, workflow },
    { status: 201 }
  );
}
