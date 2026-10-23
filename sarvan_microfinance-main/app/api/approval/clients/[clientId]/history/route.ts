import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { isSubAdminUser } from '@/app/lib/permissions/sub-admin';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/approval/clients/[clientId]/history
 * Returns the full audit trail of approval actions for a client.
 *
 * Query params:
 *   limit  – (optional) max records to return, default 100
 *   offset – (optional) pagination offset, default 0
 *
 * @access BRANCH_MANAGER, AREA_MANAGER, ADMIN, FDO (background-verification-team only),
 *         Sub Admin roles (see Role.isSubAdmin — read-only)
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ clientId: string }> }
) {
    const { clientId } = await params;

    return withAuth(async (req, user) => {
        try {
            const isSubAdmin = user.role !== 'ADMIN' && await isSubAdminUser(user.userId);
            const baseAllowedRoles = ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN', 'FDO', 'QC'];
            if (!baseAllowedRoles.includes(user.role) && !isSubAdmin) {
                return errorResponse('Insufficient permissions', 403);
            }

            const { searchParams } = new URL(req.url);
            const limit = Math.min(parseInt(searchParams.get('limit') || '100', 10), 500);
            const offset = parseInt(searchParams.get('offset') || '0', 10);

            // findFirst, not findUnique — Client.clientId isn't DB-unique (uploan-imported
            // legacy IDs can intentionally collide, see schema.prisma) — deterministic
            // oldest-created tiebreak.
            const client = await prisma.client.findFirst({
                where: { clientId },
                orderBy: { createdAt: 'asc' },
                select: {
                    id: true,
                    clientId: true,
                    firstName: true,
                    lastName: true,
                    centerId: true,
                    center: { select: { branchId: true } },
                    enrolledBy: { select: { branchId: true } },
                },
            });
            if (!client) return errorResponse('Client not found', 404);

            // Branch access for BM
            if (user.role === 'BRANCH_MANAGER') {
                const u = await prisma.user.findUnique({ where: { id: user.userId }, select: { branchId: true } });
                const clientBranchId = client.center?.branchId ?? client.enrolledBy?.branchId ?? null;
                if (!u?.branchId || clientBranchId !== u.branchId) {
                    return errorResponse('Client does not belong to your branch', 403);
                }
            }

            const [history, totalCount] = await Promise.all([
                prisma.clientApprovalHistory.findMany({
                    where: { clientId: client.id },
                    select: {
                        id: true,
                        action: true,
                        remarks: true,
                        kycDocumentId: true,
                        previousState: true,
                        newState: true,
                        createdAt: true,
                        performedBy: {
                            select: {
                                id: true,
                                firstName: true,
                                lastName: true,
                                role: true,
                            },
                        },
                    },
                    orderBy: { createdAt: 'desc' },
                    take: limit,
                    skip: offset,
                }),
                prisma.clientApprovalHistory.count({
                    where: { clientId: client.id },
                }),
            ]);

            return successResponse(
                {
                    clientId: client.clientId,
                    clientName: `${client.firstName} ${client.lastName}`,
                    history,
                    pagination: {
                        total: totalCount,
                        limit,
                        offset,
                        hasMore: offset + limit < totalCount,
                    },
                },
                'Approval history fetched'
            );
        } catch (error) {
            console.error('Error fetching approval history:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to fetch approval history',
                500
            );
        }
    })(request);
}
