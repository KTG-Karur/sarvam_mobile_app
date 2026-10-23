import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * POST /api/co-applicants/[id]/activate
 * Marks an APPROVED co-applicant ACTIVE for its client, and demotes whichever
 * co-applicant was previously ACTIVE for that same client to INACTIVE — only
 * one may be Active at a time.
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;

    return withAuth(async (req, user) => {
        try {
            const coApplicant = await prisma.coApplicant.findUnique({
                where: { id },
                select: {
                    id: true,
                    status: true,
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
            if (coApplicant.status !== 'APPROVED') {
                return errorResponse(`Only a fully approved co-applicant can be activated (status: ${coApplicant.status})`, 400);
            }

            const isBM = user.role === 'BRANCH_MANAGER';
            const isAdmin = user.role === 'ADMIN';
            if (!isBM && !isAdmin) {
                return errorResponse('Only Branch Manager or Admin can activate a co-applicant', 403);
            }
            if (isBM) {
                const clientBranchId = coApplicant.client.center?.branchId ?? coApplicant.client.enrolledBy?.branchId ?? null;
                const requester = await prisma.user.findUnique({ where: { id: user.userId }, select: { branchId: true } });
                if (!requester?.branchId || clientBranchId !== requester.branchId) {
                    return errorResponse('Client does not belong to your branch', 403);
                }
            }

            const now = new Date();
            const result = await prisma.$transaction(async (tx) => {
                const previouslyActive = await tx.coApplicant.findFirst({
                    where: { clientId: coApplicant.clientId, status: 'ACTIVE', id: { not: id } },
                    select: { id: true },
                });

                if (previouslyActive) {
                    await tx.coApplicant.update({
                        where: { id: previouslyActive.id },
                        data: { status: 'INACTIVE', inactivatedById: user.userId, inactivatedAt: now },
                    });
                    await tx.coApplicantHistory.create({
                        data: {
                            coApplicantId: previouslyActive.id,
                            action: 'DEACTIVATED',
                            performedById: user.userId,
                            remarks: `Superseded by co-applicant ${id} being activated`,
                        },
                    });
                }

                const activated = await tx.coApplicant.update({
                    where: { id },
                    data: { status: 'ACTIVE', activatedById: user.userId, activatedAt: now },
                });
                await tx.coApplicantHistory.create({
                    data: {
                        coApplicantId: id,
                        action: 'ACTIVATED',
                        performedById: user.userId,
                    },
                });

                return activated;
            });

            return successResponse(result, 'Co-applicant activated');
        } catch (error) {
            console.error('Error activating co-applicant:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to activate co-applicant', 500);
        }
    })(request);
}
