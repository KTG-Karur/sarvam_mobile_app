import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { ClientApprovalStatus } from '@prisma/client';
import { getActiveWorkflowConfig } from '@/app/lib/workflow-config';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * POST /api/approval/clients/[clientId]/documents/bulk-verify
 * Bulk-verify all pending docs for the active review stage.
 *
 * Body:
 *   decision?: "VERIFIED" (defaults to VERIFIED)
 *
 * @access BRANCH_MANAGER, AREA_MANAGER, ADMIN, FDO (background-verification-team RBAC only)
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ clientId: string }> }
) {
    const { clientId } = await params;

    return withRole(['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN', 'FDO', 'QC'], async (req, user) => {
        try {
            const body = (await req.json().catch(() => ({}))) as { decision?: 'VERIFIED' };
            const decision = body.decision ?? 'VERIFIED';

            if (decision !== 'VERIFIED') {
                return errorResponse('Bulk verify endpoint only supports VERIFIED', 400);
            }

            // findFirst, not findUnique — Client.clientId isn't DB-unique (uploan-imported
            // legacy IDs can intentionally collide, see schema.prisma) — deterministic
            // oldest-created tiebreak.
            const client = await prisma.client.findFirst({
                where: { clientId },
                orderBy: { createdAt: 'asc' },
                select: {
                    id: true,
                    approvalStatus: true,
                    center: { select: { branchId: true } },
                    enrolledBy: { select: { branchId: true } },
                },
            });

            if (!client) return errorResponse('Client not found', 404);

            if (user.role === 'BRANCH_MANAGER') {
                const currentUser = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: { branchId: true },
                });

                const clientBranchId = client.center?.branchId ?? client.enrolledBy?.branchId ?? null;
                if (!currentUser?.branchId || clientBranchId !== currentUser.branchId) {
                    return errorResponse('Client does not belong to your branch', 403);
                }
            }

            // The status → BM/AM/QC mapping below is the legacy fixed order. With a
            // dynamic workflow, documents are verified individually per stage via
            // /documents/[documentId]/review (any role, any level).
            if (await getActiveWorkflowConfig()) {
                return errorResponse('A dynamic approval workflow is active — verify each document individually from your stage.', 409);
            }

            const status = client.approvalStatus as ClientApprovalStatus;
            const now = new Date();

            // QC role is always Quality Checkers. FDO needs the RBAC assignment.
            const isQCTeam = user.role === 'QC' || !!(await prisma.userRoleAssignment.findFirst({
                where: {
                    userId: user.userId,
                    isActive: true,
                    role: { slug: 'quality-checkers', isActive: true },
                },
            }));

            if (user.role === 'FDO' && !isQCTeam) {
                return errorResponse('FDO can only bulk-verify as Quality Checkers', 403);
            }

            const bmAllowedStatuses: ClientApprovalStatus[] = ['SUBMITTED', 'PENDING_BM_REVIEW'];
            const amAllowedStatuses: ClientApprovalStatus[] = ['PENDING_AM_REVIEW'];
            const qcAllowedStatuses: ClientApprovalStatus[] = ['PENDING_QC_VERIFICATION'];

            if (bmAllowedStatuses.includes(status)) {
                if (!(user.role === 'BRANCH_MANAGER' || user.role === 'ADMIN')) {
                    return errorResponse('You are not allowed to bulk verify at BM stage', 403);
                }

                const pendingDocs = await prisma.kYC.findMany({
                    where: {
                        clientId: client.id,
                        isDeleted: false,
                        bmDecision: 'PENDING',
                    },
                    select: { id: true },
                });

                if (pendingDocs.length === 0) {
                    return successResponse({ verifiedCount: 0 }, 'No BM pending documents to verify');
                }

                const docIds = pendingDocs.map((d) => d.id);

                await prisma.$transaction(async (tx) => {
                    await tx.kYC.updateMany({
                        where: {
                            id: { in: docIds },
                            clientId: client.id,
                            isDeleted: false,
                            bmDecision: 'PENDING',
                        },
                        data: {
                            bmDecision: 'VERIFIED',
                            bmRemark: null,
                            bmReviewerId: user.userId,
                            bmReviewedAt: now,
                            status: 'VERIFIED',
                        },
                    });

                    await tx.clientApprovalHistory.createMany({
                        data: docIds.map((docId) => ({
                            clientId: client.id,
                            action: 'BM_VERIFIED_DOCUMENT' as any,
                            performedById: user.userId,
                            remarks: `Document verified in bulk (${docIds.length})`,
                            kycDocumentId: docId,
                            previousState: null,
                            newState: null,
                        })),
                    });
                });

                return successResponse(
                    { verifiedCount: docIds.length },
                    `Bulk verified ${docIds.length} document(s) (BM)`
                );
            }

            if (amAllowedStatuses.includes(status)) {
                if (!(user.role === 'AREA_MANAGER' || user.role === 'ADMIN')) {
                    return errorResponse('You are not allowed to bulk verify at AM stage', 403);
                }

                const pendingDocs = await prisma.kYC.findMany({
                    where: {
                        clientId: client.id,
                        isDeleted: false,
                        amDecision: 'PENDING',
                        bmDecision: { not: 'PENDING' },
                    },
                    select: { id: true },
                });

                if (pendingDocs.length === 0) {
                    return successResponse({ verifiedCount: 0 }, 'No AM pending documents to verify');
                }

                const docIds = pendingDocs.map((d) => d.id);

                await prisma.$transaction(async (tx) => {
                    await tx.kYC.updateMany({
                        where: {
                            id: { in: docIds },
                            clientId: client.id,
                            isDeleted: false,
                            amDecision: 'PENDING',
                            bmDecision: { not: 'PENDING' },
                        },
                        data: {
                            amDecision: 'VERIFIED',
                            amRemark: null,
                            amReviewerId: user.userId,
                            amReviewedAt: now,
                            status: 'VERIFIED',
                        },
                    });

                    await tx.clientApprovalHistory.createMany({
                        data: docIds.map((docId) => ({
                            clientId: client.id,
                            action: 'AM_VERIFIED_DOCUMENT' as any,
                            performedById: user.userId,
                            remarks: `Document verified in bulk (${docIds.length})`,
                            kycDocumentId: docId,
                            previousState: null,
                            newState: null,
                        })),
                    });
                });

                return successResponse(
                    { verifiedCount: docIds.length },
                    `Bulk verified ${docIds.length} document(s) (AM)`
                );
            }

            // ── QC Stage ──
            if (qcAllowedStatuses.includes(status)) {
                if (!isQCTeam && user.role !== 'ADMIN') {
                    return errorResponse('Only Quality Checkers can bulk verify at QC stage', 403);
                }

                const pendingDocs = await prisma.kYC.findMany({
                    where: {
                        clientId: client.id,
                        isDeleted: false,
                        qcDecision: 'PENDING',
                        amDecision: { not: 'PENDING' },
                    },
                    select: { id: true },
                });

                if (pendingDocs.length === 0) {
                    return successResponse({ verifiedCount: 0 }, 'No QC pending documents to verify');
                }

                const docIds = pendingDocs.map((d) => d.id);

                await prisma.$transaction(async (tx) => {
                    await tx.kYC.updateMany({
                        where: {
                            id: { in: docIds },
                            clientId: client.id,
                            isDeleted: false,
                            qcDecision: 'PENDING',
                        },
                        data: {
                            qcDecision: 'VERIFIED',
                            qcRemark: null,
                            qcReviewerId: user.userId,
                            qcReviewedAt: now,
                            status: 'VERIFIED',
                        },
                    });

                    await tx.clientApprovalHistory.createMany({
                        data: docIds.map((docId) => ({
                            clientId: client.id,
                            action: 'QC_VERIFIED_DOCUMENT' as never,
                            performedById: user.userId,
                            remarks: `Document verified in bulk by QC (${docIds.length})`,
                            kycDocumentId: docId,
                            previousState: null,
                            newState: null,
                        })),
                    });
                });

                return successResponse(
                    { verifiedCount: docIds.length },
                    `Bulk verified ${docIds.length} document(s) (QC)`
                );
            }

            return errorResponse(
                `Bulk verify is not allowed from current status: ${client.approvalStatus}`,
                400
            );
        } catch (error) {
            console.error('Error bulk verifying documents:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to bulk verify documents',
                500
            );
        }
    })(request);
}

