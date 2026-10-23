import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { withAuth, errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { deleteKycDocument, extractFileKeyFromUrl } from '@/app/lib/storage/kyc-storage';
import {
    CLIENT_KYC_DOCUMENT_TYPE_VALUES,
    CO_APPLICANT_KYC_DOCUMENT_TYPE_VALUES,
    SUPPORTED_KYC_DOCUMENT_TYPE_VALUES,
} from '@/app/lib/kyc-document-types';
import { buildKycResetData } from '@/app/lib/kyc-verification';
import { isSubAdminUser } from '@/app/lib/permissions/sub-admin';
import { getAllowFdoEditApprovedClient } from '@/app/lib/fdo-approved-client-edit-config';
import { getAllowBmEditApprovedClient } from '@/app/lib/bm-approved-client-edit-config';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/clients/[clientId]/kyc-documents
 * Fetch KYC documents for a specific client
 * 
 * @access All authenticated users with role-based access
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ clientId: string }> }
) {
    return withAuth(async (req, user) => {
        try {
            const { clientId } = await params;
            const { searchParams } = new URL(req.url);
            const scope = searchParams.get('scope') || 'client';
            const coApplicantId = searchParams.get('coApplicantId');

            const allowedDocumentTypes =
                scope === 'co_applicant'
                    ? CO_APPLICANT_KYC_DOCUMENT_TYPE_VALUES
                    : scope === 'all'
                        ? SUPPORTED_KYC_DOCUMENT_TYPE_VALUES
                        : CLIENT_KYC_DOCUMENT_TYPE_VALUES;

            if (!clientId) {
                return errorResponse('Client ID is required', 400);
            }

            // Find client by clientId (not database id) — findFirst, not findUnique:
            // Client.clientId isn't DB-unique (uploan-imported legacy IDs can
            // intentionally collide, see schema.prisma) — deterministic oldest-created
            // tiebreak.
            const client = await prisma.client.findFirst({
                where: { clientId },
                orderBy: { createdAt: 'asc' },
                select: {
                    id: true,
                    clientId: true,
                    firstName: true,
                    lastName: true,
                    centerId: true,
                    center: {
                        select: {
                            branchId: true,
                        },
                    },
                    enrolledBy: { select: { id: true, branchId: true } },
                },
            });

            if (!client) {
                return errorResponse('Client not found', 404);
            }

            // Role-based access control
            if (user.role === 'BRANCH_MANAGER') {
                const userRecord = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: { branchId: true },
                });

                if (!userRecord || !userRecord.branchId || (client.center?.branchId ?? client.enrolledBy?.branchId) !== userRecord.branchId) {
                    return errorResponse('Insufficient permissions: Client is not in your branch', 403);
                }
            } else if (user.role === 'FDO') {
                const userRecord = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: {
                        branchId: true,
                        assignedCenters: {
                            select: { id: true },
                        },
                    },
                });

                const centersWithFdoId = await prisma.center.findMany({
                    where: { fdoId: user.userId },
                    select: { id: true },
                });

                const assignedCenterIds = [
                    ...(userRecord?.assignedCenters?.map((c) => c.id) || []),
                    ...centersWithFdoId.map((c) => c.id),
                ];

                const uniqueCenterIds = [...new Set(assignedCenterIds)];

                // Check if client's center is assigned OR if it's an APPROVED center in FDO's branch
                let hasAccess = uniqueCenterIds.includes(client.centerId ?? "");

                if (!hasAccess && userRecord?.branchId && client.center?.branchId === userRecord.branchId) {
                    // Check if it's an APPROVED center in FDO's branch
                    const approvedCenter = await prisma.center.findFirst({
                        where: {
                            id: client.centerId ?? undefined,
                            branchId: userRecord.branchId,
                            status: 'APPROVED',
                        },
                        select: { id: true },
                    });
                    hasAccess = !!approvedCenter;
                }

                // Grant access when client has no center but was enrolled by someone in FDO's branch
                if (!hasAccess && userRecord?.branchId && client.enrolledBy?.branchId === userRecord.branchId) {
                    hasAccess = true;
                }

                if (!hasAccess) {
                    return errorResponse('Insufficient permissions: Client is not in your assigned centers', 403);
                }
            }

            // Fetch KYC documents for this client — optionally scoped to one
            // specific co-applicant (a client can have several over time).
            const kycDocuments = await prisma.kYC.findMany({
                where: {
                    clientId: client.id,
                    documentType: {
                        in: allowedDocumentTypes,
                    },
                    ...(coApplicantId ? { coApplicantId } : {}),
                },
                select: {
                    id: true,
                    documentType: true,
                    fileUrl: true,
                    fileName: true,
                    fileSize: true,
                    mimeType: true,
                    createdAt: true,
                },
                orderBy: {
                    createdAt: 'desc',
                },
            });

            return successResponse(
                {
                    clientId: client.clientId,
                    documents: kycDocuments.map((doc) => ({
                        id: doc.id,
                        documentType: doc.documentType,
                        fileUrl: doc.fileUrl,
                        fileName: doc.fileName,
                        fileSize: doc.fileSize,
                        mimeType: doc.mimeType,
                        uploadedAt: doc.createdAt,
                    })),
                },
                'KYC documents fetched successfully'
            );
        } catch (error) {
            console.error('Error fetching KYC documents:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to fetch KYC documents',
                500
            );
        }
    })(request);
}

/**
 * DELETE /api/clients/[clientId]/kyc-documents
 * Delete a KYC document for a specific client
 * 
 * @access FDO, BRANCH_MANAGER, AREA_MANAGER, ADMIN
 */
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ clientId: string }> }
) {
    return withAuth(async (req, user) => {
        try {
            const { clientId } = await params;
            const { searchParams } = new URL(req.url);
            const documentId = searchParams.get('documentId');

            if (!clientId) {
                return errorResponse('Client ID is required', 400);
            }

            if (!documentId) {
                return errorResponse('Document ID is required', 400);
            }

            // Find client by clientId — findFirst, not findUnique: Client.clientId isn't
            // DB-unique (uploan-imported legacy IDs can intentionally collide, see
            // schema.prisma) — deterministic oldest-created tiebreak.
            const client = await prisma.client.findFirst({
                where: { clientId },
                orderBy: { createdAt: 'asc' },
                select: {
                    id: true,
                    centerId: true,
                    approvalStatus: true,
                    center: {
                        select: {
                            branchId: true,
                        },
                    },
                    enrolledBy: { select: { id: true, branchId: true } },
                },
            });

            if (!client) {
                return errorResponse('Client not found', 404);
            }

            // Role-based access control
            if (user.role === 'BRANCH_MANAGER') {
                const userRecord = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: { branchId: true },
                });

                if (!userRecord || !userRecord.branchId || (client.center?.branchId ?? client.enrolledBy?.branchId) !== userRecord.branchId) {
                    return errorResponse('Insufficient permissions: Client is not in your branch', 403);
                }
            } else if (user.role === 'FDO') {
                const userRecord = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: {
                        branchId: true,
                        assignedCenters: {
                            select: { id: true },
                        },
                    },
                });

                const centersWithFdoId = await prisma.center.findMany({
                    where: { fdoId: user.userId },
                    select: { id: true },
                });

                const assignedCenterIds = [
                    ...(userRecord?.assignedCenters?.map((c) => c.id) || []),
                    ...centersWithFdoId.map((c) => c.id),
                ];

                const uniqueCenterIds = [...new Set(assignedCenterIds)];

                // Check if client's center is assigned OR if it's an APPROVED center in FDO's branch
                let hasAccess = uniqueCenterIds.includes(client.centerId ?? "");

                if (!hasAccess && userRecord?.branchId && client.center?.branchId === userRecord.branchId) {
                    // Check if it's an APPROVED center in FDO's branch
                    const approvedCenter = await prisma.center.findFirst({
                        where: {
                            id: client.centerId ?? undefined,
                            branchId: userRecord.branchId,
                            status: 'APPROVED',
                        },
                        select: { id: true },
                    });
                    hasAccess = !!approvedCenter;
                }

                // Grant access when client has no center but was enrolled by someone in FDO's branch
                if (!hasAccess && userRecord?.branchId && client.enrolledBy?.branchId === userRecord.branchId) {
                    hasAccess = true;
                }

                if (!hasAccess) {
                    return errorResponse('Insufficient permissions: Client is not in your assigned centers', 403);
                }
            }

            // Find the document
            const document = await prisma.kYC.findFirst({
                where: {
                    id: documentId,
                    clientId: client.id,
                    documentType: {
                        in: SUPPORTED_KYC_DOCUMENT_TYPE_VALUES,
                    },
                },
                select: {
                    id: true,
                    fileUrl: true,
                    coApplicantId: true,
                },
            });

            if (!document) {
                return errorResponse('Document not found', 404);
            }

            // Delete from S3 if fileUrl exists
            if (document.fileUrl) {
                try {
                    const fileKey = extractFileKeyFromUrl(document.fileUrl);
                    if (fileKey) {
                        await deleteKycDocument(fileKey);
                    }
                } catch (s3Error) {
                    console.error('Error deleting file from S3:', s3Error);
                    // Continue with database deletion even if S3 deletion fails
                }
            }

            // Delete database record
            await prisma.kYC.delete({
                where: { id: document.id },
            });

            // Co-applicant documents don't affect the client's own KYC/approval
            // status — co-applicant approval is its own independent workflow.
            // Also skip the reset when an Admin/Sub Admin/Branch Manager/FDO
            // deletes a document on an already-APPROVED client — their own
            // correction shouldn't re-queue the client for BM -> AM -> QC -> Admin
            // again.
            if (!document.coApplicantId) {
                const isAdminRole = user.role === 'ADMIN' || user.role === 'ADMIN_NON_HO_BRANCH_SWITCH';
                const isFdoExempt =
                    user.role === 'FDO' &&
                    client.approvalStatus === 'APPROVED' &&
                    (await getAllowFdoEditApprovedClient());
                const isBmExempt =
                    user.role === 'BRANCH_MANAGER' &&
                    client.approvalStatus === 'APPROVED' &&
                    (await getAllowBmEditApprovedClient());
                const isAdminOrSubAdminEditingApprovedClient =
                    client.approvalStatus === 'APPROVED' &&
                    (isAdminRole || isBmExempt || isFdoExempt || (await isSubAdminUser(user.userId)));

                // A DRAFT must not be pushed into the approval queue by a document change.
                if (!isAdminOrSubAdminEditingApprovedClient && (client.approvalStatus as string) !== 'DRAFT') {
                    await prisma.client.update({
                        where: { id: client.id },
                        data: buildKycResetData(),
                    });
                }
            }

            return successResponse(null, 'KYC document deleted successfully');
        } catch (error) {
            console.error('Error deleting KYC document:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to delete KYC document',
                500
            );
        }
    })(request);
}
