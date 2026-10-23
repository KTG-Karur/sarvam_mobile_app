import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { applyOrgScope } from '@/app/lib/permissions/org-scope';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/co-applicants/approval-queue
 * Lists co-applicants pending at the caller's own review stage — feeds the
 * "Co-Applicant Approval" tab in the Approval Workbench. BM/AM are branch
 * scoped; QC and Admin are not (matches KYC document review today).
 */
export async function GET(request: NextRequest) {
    return withAuth(async (_req, user) => {
        try {
            let stage: 'BM' | 'AM' | 'QC' | 'ADMIN' | null = null;
            let branchIds: string[] | null = null;

            if (user.role === 'ADMIN') {
                stage = 'ADMIN';
            } else if (user.role === 'BRANCH_MANAGER') {
                stage = 'BM';
                const requester = await prisma.user.findUnique({ where: { id: user.userId }, select: { branchId: true } });
                if (!requester?.branchId) return successResponse([], 'No branch assigned');
                branchIds = [requester.branchId];
            } else if (user.role === 'AREA_MANAGER') {
                stage = 'AM';
                branchIds = await getPermittedBranchIds(user);
                if (!branchIds || branchIds.length === 0) return successResponse([], 'No branches assigned to this Area Manager');
            } else {
                const isQCTeam = !!(await prisma.userRoleAssignment.findFirst({
                    where: { userId: user.userId, isActive: true, role: { slug: 'quality-checkers', isActive: true } },
                }));
                if (isQCTeam) stage = 'QC';
            }

            if (!stage) {
                return errorResponse('Your role does not review co-applicant approvals', 403);
            }

            // Narrow by the user's Region/Division/Area/Branch org scope, if any
            // (e.g. a Quality Checker assigned to one Area sees only that Area).
            branchIds = await applyOrgScope(user.userId, branchIds);

            const coApplicants = await prisma.coApplicant.findMany({
                where: {
                    status: 'PENDING_APPROVAL',
                    currentStage: stage,
                    ...(branchIds ? {
                        client: {
                            OR: [
                                { center: { branchId: { in: branchIds } } },
                                // Unassigned client — scope by its requested center's branch
                                // (Loan Details tab selection), not the enroller's own branch.
                                { center: null, requestedCenter: { branchId: { in: branchIds } } },
                            ],
                        },
                    } : {}),
                },
                include: {
                    economicActivityType: { select: { id: true, name: true } },
                    economicActivity: { select: { id: true, name: true } },
                    client: {
                        select: {
                            id: true,
                            clientId: true,
                            firstName: true,
                            lastName: true,
                            center: { select: { id: true, name: true, code: true } },
                        },
                    },
                    kycDocuments: {
                        where: { isDeleted: false },
                        select: { id: true, documentType: true, fileUrl: true, documentNumber: true },
                    },
                },
                orderBy: { createdAt: 'asc' },
            });

            return successResponse(coApplicants, 'Approval queue fetched');
        } catch (error) {
            console.error('Error fetching co-applicant approval queue:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to fetch approval queue', 500);
        }
    })(request);
}
