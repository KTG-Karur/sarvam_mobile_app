import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { z } from 'zod';
import { ClientApprovalStatus } from '@prisma/client';
import { getAllStageStatuses, invalidateWorkflowCache } from '@/app/lib/workflow-config';

// Every status that means "somewhere inside the BM/AM/QC or level chain" —
// used to find in-flight members a new config no longer has a stage for.
const IN_CHAIN_STATUSES = Object.values(ClientApprovalStatus).filter(
    st => !['DRAFT', 'PENDING_FINAL_REVIEW', 'FINAL_RETAKE_REQUIRED', 'APPROVED', 'REJECTED'].includes(st)
);

const stagesSchema = z.object({
    stages: z.array(z.object({
        levelOrder: z.number().int().min(1),
        roleSlug: z.string().trim().min(1, 'Each stage needs a role'),
        stageName: z.string().trim().min(1, 'Each stage needs a name').max(100),
    })).min(1, 'At least one stage is required').max(5, 'Maximum 5 middle stages allowed'),
});

function subAdminStageMessage(roleName: string): string {
    return `"${roleName}" is a Sub Admin role (final approval only) and can't be added as an approval stage. Turn off Sub Admin for this role first, or choose another role.`;
}

// 'background-verification-team' is the legacy slug of 'quality-checkers'.
const canonical = (slug: string) => (slug === 'background-verification-team' ? 'quality-checkers' : slug);

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/admin/client-workflow
 * Returns the active workflow config + all available RBAC roles for configuration.
 * @access ADMIN
 */
export async function GET(request: NextRequest) {
    return withRole(['ADMIN'], async () => {
        try {
            const [config, roles] = await Promise.all([
                prisma.clientWorkflowConfig.findFirst({
                    where: { isActive: true },
                    include: { stages: { orderBy: { levelOrder: 'asc' } } },
                }),
                prisma.role.findMany({
                    where: { isActive: true },
                    select: { id: true, name: true, slug: true, color: true, description: true, isSubAdmin: true },
                    orderBy: { priority: 'desc' },
                }),
            ]);

            return successResponse({ config, roles }, 'Workflow config fetched');
        } catch (error) {
            return errorResponse(error instanceof Error ? error.message : 'Failed to fetch', 500);
        }
    })(request);
}

/**
 * PUT /api/admin/client-workflow
 * Saves a new active workflow config (deactivates the previous one).
 * Body: { stages: [{ levelOrder, roleSlug, stageName }] }
 * @access ADMIN
 */
export async function PUT(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const parsed = stagesSchema.safeParse(await req.json());
            if (!parsed.success) return errorResponse(parsed.error.errors[0].message, 400);
            const { stages } = parsed.data;

            // Validate levelOrder is sequential 1..N
            const sorted = [...stages].sort((a, b) => a.levelOrder - b.levelOrder);
            for (let i = 0; i < sorted.length; i++) {
                if (sorted[i].levelOrder !== i + 1) {
                    return errorResponse('Stage levelOrder must be sequential starting from 1', 400);
                }
            }

            // A role may hold only one stage — decisions and queue statuses are keyed
            // by role, so the same role twice would make its second stage unreachable.
            const seen = new Set<string>();
            for (const s of stages) {
                const slug = canonical(s.roleSlug);
                if (seen.has(slug)) {
                    return errorResponse(`Role "${s.roleSlug}" is used in more than one stage — each role can hold only one stage`, 400);
                }
                seen.add(slug);
            }
            if (seen.has('admin')) {
                return errorResponse('Admin is always the fixed final stage and cannot be a middle stage', 400);
            }

            // Every role must exist and be active, or nobody could ever act at that stage.
            const roles = await prisma.role.findMany({
                where: { slug: { in: stages.map(s => s.roleSlug) }, isActive: true },
                select: { slug: true, name: true, isSubAdmin: true },
            });
            const activeSlugs = new Set(roles.map(r => r.slug));
            const missing = stages.find(s => !activeSlugs.has(s.roleSlug));
            if (missing) {
                return errorResponse(`Role "${missing.roleSlug}" does not exist or is inactive`, 400);
            }

            // A Sub Admin role is a final approver (like Admin) — it can't also be a
            // middle approval stage.
            const subAdmin = roles.find(r => r.isSubAdmin);
            if (subAdmin) {
                return errorResponse(subAdminStageMessage(subAdmin.name), 400);
            }

            // Deactivate previous configs + create the new one atomically
            const config = await prisma.$transaction(async (tx) => {
                await tx.clientWorkflowConfig.updateMany({
                    where: { isActive: true },
                    data: { isActive: false },
                });
                return tx.clientWorkflowConfig.create({
                    data: {
                        isActive: true,
                        stages: {
                            create: stages.map((s) => ({
                                levelOrder: s.levelOrder,
                                roleSlug: s.roleSlug,
                                stageName: s.stageName,
                            })),
                        },
                    },
                    include: { stages: { orderBy: { levelOrder: 'asc' } } },
                });
            });

            invalidateWorkflowCache();

            // In-flight members whose current status has no stage in the new config
            // (e.g. a role was removed) can't be acted on until reset — report them.
            const recognised = new Set<string>(getAllStageStatuses(config.stages));
            const strandedCount = await prisma.client.count({
                where: {
                    isActive: true,
                    approvalStatus: { in: IN_CHAIN_STATUSES.filter(st => !recognised.has(st)) },
                },
            });

            return successResponse(
                { config, strandedCount },
                strandedCount > 0
                    ? `Workflow saved. ${strandedCount} member(s) are at a stage that no longer exists in this flow.`
                    : 'Workflow config saved successfully'
            );
        } catch (error) {
            return errorResponse(error instanceof Error ? error.message : 'Failed to save', 500);
        }
    })(request);
}

/**
 * DELETE /api/admin/client-workflow
 * Deactivates all configs (revert to legacy hardcoded flow).
 * @access ADMIN
 */
export async function DELETE(request: NextRequest) {
    return withRole(['ADMIN'], async () => {
        try {
            await prisma.clientWorkflowConfig.updateMany({
                where: { isActive: true },
                data: { isActive: false },
            });
            invalidateWorkflowCache();
            return successResponse({}, 'Workflow config deactivated — system reverted to default flow');
        } catch (error) {
            return errorResponse(error instanceof Error ? error.message : 'Failed to deactivate', 500);
        }
    })(request);
}
