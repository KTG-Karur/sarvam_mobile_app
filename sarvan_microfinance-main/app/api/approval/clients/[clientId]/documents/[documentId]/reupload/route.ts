import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { KYCDocumentDecision } from '@prisma/client';
import { uploadKycDocument, deleteKycDocument, extractFileKeyFromUrl } from '@/app/lib/storage/kyc-storage';
import { SUPPORTED_KYC_DOCUMENT_TYPE_VALUES } from '@/app/lib/kyc-document-types';
import { ALL_LEVEL_RETAKE_STATUSES } from '@/app/lib/workflow-config';
import { hasAnyRetakeFlag } from '@/app/lib/kyc-stage-decisions';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// Statuses that mean "FDO needs to recheck/re-upload" — same set the
// FDO_RESUBMIT action accepts from. Re-upload is only meaningful while the
// client sits in one of these (otherwise there's nothing to resubmit).
const RECHECK_STATUSES = [
    'BM_RETAKE_REQUIRED', 'AM_RETAKE_REQUIRED', 'QC_VERIFICATION_RETAKE_REQUIRED', 'FINAL_RETAKE_REQUIRED',
    ...ALL_LEVEL_RETAKE_STATUSES,
];

/**
 * POST /api/approval/clients/[clientId]/documents/[documentId]/reupload
 * FDO replaces a KYC document's image while recheck-ing a client (see
 * /api/approval/clients/[clientId]/action's FDO_RESUBMIT for the matching
 * client-level transition). This only swaps the file + resets whichever
 * stage(s) had flagged this specific document RETAKE_REQUIRED back to
 * PENDING — it does NOT touch client.approvalStatus. Call FDO_RESUBMIT
 * afterwards (once all flagged documents are re-uploaded) to push the
 * client back into the approval queue.
 *
 * Body (multipart/form-data):
 *   file:            File (required)
 *   documentNumber:  string (optional)
 *
 * @access FDO (background-verification-team uses the per-document /review route instead)
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ clientId: string; documentId: string }> }
) {
    const { clientId, documentId } = await params;

    return withRole(['FDO', 'ADMIN'], async (req, user) => {
        try {
            // FDO acting as Quality Checkers re-uploads via a different flow (they're a reviewer, not the enroller)
            const isQCTeam = !!(await prisma.userRoleAssignment.findFirst({
                where: {
                    userId: user.userId,
                    isActive: true,
                    role: { slug: 'quality-checkers', isActive: true },
                },
            }));
            if (user.role === 'FDO' && isQCTeam) {
                return errorResponse('Quality Checkers must use the document review action', 403);
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

            // Multi-tenancy boundary — an FDO may only re-upload documents for
            // clients in their own branch (mirrors the BRANCH_MANAGER branch
            // check in /api/approval/clients/[clientId]/action).
            if (user.role === 'FDO') {
                const requester = await prisma.user.findUnique({ where: { id: user.userId }, select: { branchId: true } });
                const clientBranchId = client.center?.branchId ?? client.enrolledBy?.branchId ?? null;
                if (!requester?.branchId || clientBranchId !== requester.branchId) {
                    return errorResponse('Client does not belong to your branch', 403);
                }
            }

            const doc = await prisma.kYC.findFirst({
                where: { id: documentId, clientId: client.id, isDeleted: false },
                include: { stageReviews: { select: { roleSlug: true, decision: true } } },
            });
            if (!doc) return errorResponse('KYC document not found', 404);

            // An APPROVED client's status must never be touched by an edit (see
            // admin-edit-no-reapproval policy), so it can never sit in one of the
            // RECHECK_STATUSES — but a document can still be flagged RETAKE_REQUIRED
            // on it (e.g. BM re-reviewing an already-approved client's KYC) without
            // any client-level transition. Allow reupload there too, gated on this
            // specific document actually carrying the flag; otherwise fall back to
            // the normal client-level recheck-status gate.
            // Includes custom-role dynamic stages (KycStageReview rows).
            const docIsFlagged = hasAnyRetakeFlag(doc);
            const clientIsApprovedWithFlaggedDoc = client.approvalStatus === 'APPROVED' && docIsFlagged;
            if (!RECHECK_STATUSES.includes(client.approvalStatus) && !clientIsApprovedWithFlaggedDoc) {
                return errorResponse(
                    `Client is not currently pending a recheck (status: ${client.approvalStatus})`,
                    400
                );
            }

            if (!SUPPORTED_KYC_DOCUMENT_TYPE_VALUES.includes(doc.documentType as never)) {
                return errorResponse('Unsupported document type', 400);
            }

            const formData = await req.formData();
            const file = formData.get('file');
            const documentNumber = formData.get('documentNumber');
            if (!(file instanceof File)) {
                return errorResponse('File is required', 400);
            }

            const buffer = Buffer.from(await file.arrayBuffer());
            const uploadResult = await uploadKycDocument({
                fileBuffer: buffer,
                contentType: file.type || 'application/octet-stream',
                fileName: file.name,
                clientIdentifier: clientId,
                documentType: doc.documentType as never,
            });

            // Best-effort cleanup of the previous file — don't fail the request if this errors
            if (doc.fileUrl) {
                try {
                    const oldKey = extractFileKeyFromUrl(doc.fileUrl);
                    if (oldKey) await deleteKycDocument(oldKey);
                } catch (cleanupErr) {
                    console.error('[KYC Reupload] Failed to delete previous file:', cleanupErr);
                }
            }

            const kycUpdate: Record<string, unknown> = {
                fileUrl: uploadResult.fileUrl,
                fileName: uploadResult.fileName,
                fileSize: uploadResult.fileSize,
                mimeType: uploadResult.mimeType,
                status: 'PENDING_VERIFICATION',
                retakeReason: null,
                revisionNo: doc.revisionNo + 1,
                parentKycId: doc.id,
            };
            if (typeof documentNumber === 'string' && documentNumber.trim()) {
                kycUpdate.documentNumber = documentNumber.trim();
            }

            // Only reset the stage(s) that actually flagged this document — a doc
            // that BM already verified (and AM later flagged) keeps its BM verdict.
            if (doc.bmDecision === 'RETAKE_REQUIRED') {
                kycUpdate.bmDecision = 'PENDING' as KYCDocumentDecision;
                kycUpdate.bmRemark = null;
                kycUpdate.bmReviewerId = null;
                kycUpdate.bmReviewedAt = null;
            }
            if (doc.amDecision === 'RETAKE_REQUIRED') {
                kycUpdate.amDecision = 'PENDING' as KYCDocumentDecision;
                kycUpdate.amRemark = null;
                kycUpdate.amReviewerId = null;
                kycUpdate.amReviewedAt = null;
            }
            if (doc.qcDecision === 'RETAKE_REQUIRED') {
                kycUpdate.qcDecision = 'PENDING' as KYCDocumentDecision;
                kycUpdate.qcRemark = null;
                kycUpdate.qcReviewerId = null;
                kycUpdate.qcReviewedAt = null;
            }

            const [updatedDoc] = await prisma.$transaction([
                prisma.kYC.update({
                    where: { id: documentId },
                    data: kycUpdate,
                    select: {
                        id: true,
                        documentType: true,
                        fileUrl: true,
                        fileName: true,
                        bmDecision: true,
                        amDecision: true,
                        qcDecision: true,
                        revisionNo: true,
                        isDeleted: true,
                        status: true,
                    },
                }),
                // Custom-role dynamic stages that flagged this document → back to PENDING
                prisma.kycStageReview.updateMany({
                    where: { kycId: documentId, decision: 'RETAKE_REQUIRED' },
                    data: { decision: 'PENDING', remark: null, reviewerId: null, reviewedAt: null },
                }),
                prisma.clientApprovalHistory.create({
                    data: {
                        clientId: client.id,
                        action: 'FDO_REUPLOADED_DOCUMENT',
                        performedById: user.userId,
                        remarks: `Re-uploaded ${doc.documentType.replace(/_/g, ' ')}`,
                        kycDocumentId: documentId,
                        previousState: JSON.stringify({ fileUrl: doc.fileUrl }),
                        newState: JSON.stringify({ fileUrl: uploadResult.fileUrl }),
                    },
                }),
            ]);

            return successResponse({ document: updatedDoc }, 'Document re-uploaded successfully');
        } catch (error) {
            console.error('Error re-uploading document:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to re-upload document',
                500
            );
        }
    })(request);
}
