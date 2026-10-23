// ============================================================
// ENSURE DEFAULT APPROVAL WORKFLOWS
// app/lib/approval/ensure-defaults.ts
//
// A database that was never seeded (or was seeded before a module's approval
// existed) has no Module row and/or no workflow for it, which used to surface
// as "Module 'hr-onboarding' not found" the first time anyone submitted a
// request. These helpers create the missing pieces from DEFAULT_WORKFLOWS.
//
// Only ever fills a gap — a module that already has ANY workflow (even a
// deactivated one an admin turned off on purpose) is left exactly as it is.
// ============================================================

import { prisma } from '@/app/lib/prisma';
import { DEFAULT_WORKFLOWS, type DefaultWorkflowConfig } from './default-workflows';

export function getDefaultWorkflowConfig(moduleSlug: string): DefaultWorkflowConfig | undefined {
  return DEFAULT_WORKFLOWS.find((w) => w.moduleSlug === moduleSlug);
}

/** Returns the Module row for a default-workflow module, creating it if absent. */
export async function ensureWorkflowModule(config: DefaultWorkflowConfig) {
  const existing = await prisma.module.findUnique({ where: { slug: config.moduleSlug } });
  if (existing) return existing;

  const last = await prisma.module.findFirst({ orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } });
  return prisma.module.create({
    data: {
      name: config.moduleName,
      slug: config.moduleSlug,
      icon: config.moduleIcon,
      // Keep new modules ahead of the reserved 'admin' slot (99) in ordering.
      sortOrder: Math.min((last?.sortOrder ?? 0) + 1, 98),
      isSystem: true,
    },
  });
}

/**
 * Creates the module's default workflow when the module has none at all.
 * Returns true if it created one.
 */
export async function ensureDefaultWorkflow(moduleSlug: string): Promise<boolean> {
  const config = getDefaultWorkflowConfig(moduleSlug);
  if (!config) return false;

  const mod = await ensureWorkflowModule(config);
  const existingCount = await prisma.approvalWorkflow.count({ where: { moduleId: mod.id } });
  if (existingCount > 0) return false;

  await prisma.approvalWorkflow.create({
    data: {
      moduleId: mod.id,
      name: config.name,
      description: config.description,
      isActive: true,
      isDefault: config.isDefault,
      stages: {
        create: config.stages.map((stage) => ({
          name: stage.name,
          stageOrder: stage.stageOrder,
          approverRoleSlug: stage.approverRoleSlug,
          allowedActions: stage.allowedActions,
        })),
      },
    },
  });
  return true;
}
