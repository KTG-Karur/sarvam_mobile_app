import { prisma } from '@/app/lib/prisma';

/**
 * How many approval stages the active hr-onboarding workflow has — same
 * workflow selection startApprovalWorkflow uses (isDefault, else first
 * active). 0 when the module has no active workflow yet.
 */
export async function getOnboardingApprovalStageCount(): Promise<number> {
  const onboardingModule = await prisma.module.findUnique({
    where: { slug: 'hr-onboarding' },
    include: {
      approvalWorkflows: {
        where: { isActive: true },
        include: { stages: { select: { id: true } } },
      },
    },
  });
  const workflow =
    onboardingModule?.approvalWorkflows.find((w) => w.isDefault) ?? onboardingModule?.approvalWorkflows[0];
  return workflow?.stages.length ?? 0;
}
