import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/prisma';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { isWithinOrgScope } from '@/app/lib/permissions/org-scope';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const STAGE_ORDER = ['BM', 'AM', 'QC', 'ADMIN'] as const;
type Stage = (typeof STAGE_ORDER)[number];

const STAGE_ROLE: Record<Stage, string> = {
    BM: 'BRANCH_MANAGER',
    AM: 'AREA_MANAGER',
    QC: 'QC',
    ADMIN: 'ADMIN',
};

const bodySchema = z.object({
    action: z.enum(['approve', 'reject']),
    remarks: z.string().trim().optional(),
});

/**
 * POST /api/co-applicants/[id]/action
 * Approve or reject a co-applicant at whichever stage (BM/AM/QC/Admin) it's
 * currently pending at. Mirrors the KYC model's per-stage decision pattern.
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    return withAuth(async (req, user) => {
        try {
            const parsed = bodySchema.safeParse(await req.json().catch(() => ({})));
            if (!parsed.success) {
                return errorResponse(parsed.error.errors[0]?.message || 'Invalid request', 400);
            }
            const { action, remarks } = parsed.data;
            if (action === 'reject' && !remarks?.trim()) {
                return errorResponse('Remarks are required to reject', 400);
            }

            const coApplicant = await prisma.coApplicant.findUnique({
                where: { id },
                select: {
                    id: true,
                    status: true,
                    currentStage: true,
                    clientId: true,
                    client: {
                        select: {
                            center: { select: { branchId: true } },
                            enrolledBy: { select: { branchId: true } },
                        },
                    },
                },
            });
            if (!coApplicant) return errorResponse('Co-applicant not found', 404);
            if (coApplicant.status !== 'PENDING_APPROVAL' || !coApplicant.currentStage) {
                return errorResponse(`Co-applicant is not pending approval (status: ${coApplicant.status})`, 400);
            }

            const stage = coApplicant.currentStage as Stage;
            const isAdmin = user.role === 'ADMIN';

            // Role gate — QC uses the same "Quality Checkers" RBAC role assignment
            // check as the client-approval flow, not the legacy QC enum value alone.
            let hasStageRole = user.role === STAGE_ROLE[stage];
            if (stage === 'QC' && !hasStageRole) {
                hasStageRole = !!(await prisma.userRoleAssignment.findFirst({
                    where: { userId: user.userId, isActive: true, role: { slug: 'quality-checkers', isActive: true } },
                }));
            }
            if (!hasStageRole && !isAdmin) {
                return errorResponse(`Only ${STAGE_ROLE[stage]} can act on this co-applicant right now`, 403);
            }

            // Region/Division/Area/Branch org scope (any stage, e.g. a Quality
            // Checker assigned to one Division) — only narrows, never widens.
            if (!(await isWithinOrgScope(
                user.userId,
                coApplicant.client.center?.branchId ?? coApplicant.client.enrolledBy?.branchId ?? null,
            ))) {
                return errorResponse('Client is outside your assigned Region / Division / Area', 403);
            }

            // Branch scoping — BM/AM may only act on co-applicants in their own /
            // assigned branch(es). QC and Admin are not branch-restricted (matches
            // how QC reviews KYC documents company-wide today).
            if (stage === 'BM' || stage === 'AM') {
                const clientBranchId = coApplicant.client.center?.branchId ?? coApplicant.client.enrolledBy?.branchId ?? null;
                if (!isAdmin) {
                    if (stage === 'BM') {
                        const requester = await prisma.user.findUnique({ where: { id: user.userId }, select: { branchId: true } });
                        if (!requester?.branchId || clientBranchId !== requester.branchId) {
                            return errorResponse('Client does not belong to your branch', 403);
                        }
                    } else {
                        const permittedBranchIds = await getPermittedBranchIds(user);
                        if (permittedBranchIds !== null && (!clientBranchId || !permittedBranchIds.includes(clientBranchId))) {
                            return errorResponse('Client does not belong to one of your assigned branches', 403);
                        }
                    }
                }
            }

            const now = new Date();
            const stageDataKey = stage.toLowerCase();

            const result = await prisma.$transaction(async (tx) => {
                if (action === 'reject') {
                    const updated = await tx.coApplicant.update({
                        where: { id },
                        data: {
                            status: 'REJECTED',
                            currentStage: null,
                            [`${stageDataKey}Decision`]: 'REJECTED',
                            [`${stageDataKey}Remark`]: remarks?.trim() || null,
                            [`${stageDataKey}ReviewerId`]: user.userId,
                            [`${stageDataKey}ReviewedAt`]: now,
                        },
                    });
                    await tx.coApplicantHistory.create({
                        data: {
                            coApplicantId: id,
                            action: `${stage}_REJECTED`,
                            performedById: user.userId,
                            remarks: remarks?.trim() || null,
                        },
                    });
                    return updated;
                }

                const nextStageIndex = STAGE_ORDER.indexOf(stage) + 1;
                const nextStage: Stage | null = nextStageIndex < STAGE_ORDER.length ? STAGE_ORDER[nextStageIndex] : null;

                const updated = await tx.coApplicant.update({
                    where: { id },
                    data: {
                        [`${stageDataKey}Decision`]: 'APPROVED',
                        [`${stageDataKey}Remark`]: remarks?.trim() || null,
                        [`${stageDataKey}ReviewerId`]: user.userId,
                        [`${stageDataKey}ReviewedAt`]: now,
                        currentStage: nextStage,
                        status: nextStage ? 'PENDING_APPROVAL' : 'APPROVED',
                    },
                });
                await tx.coApplicantHistory.create({
                    data: {
                        coApplicantId: id,
                        action: `${stage}_APPROVED`,
                        performedById: user.userId,
                        remarks: remarks?.trim() || null,
                    },
                });
                return updated;
            });

            return successResponse(result, action === 'approve' ? 'Approved' : 'Rejected');
        } catch (error) {
            console.error('Error processing co-applicant action:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to process action', 500);
        }
    })(request);
}
