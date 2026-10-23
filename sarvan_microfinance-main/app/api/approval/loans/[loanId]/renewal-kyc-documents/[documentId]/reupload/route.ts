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

export async function OPTIONS() {
    return handleCorsPreflight();
}

// Same set renewal-action's FDO_RESUBMIT accepts from — re-upload is only meaningful
// while the renewal sits in one of these (otherwise there's nothing to resubmit).
const RENEWAL_RECHECK_STATUSES: string[] = [
    'BM_RETAKE_REQUIRED', 'AM_RETAKE_REQUIRED', 'QC_VERIFICATION_RETAKE_REQUIRED', 'FINAL_RETAKE_REQUIRED',
    ...ALL_LEVEL_RETAKE_STATUSES,
];

/**
 * POST /api/approval/loans/[loanId]/renewal-kyc-documents/[documentId]/reupload
 *
 * Renewal-loan analogue of /api/approval/clients/[clientId]/documents/[documentId]/reupload.
 * The FDO replaces ONE loan-scoped renewal image (house images / location QR / gas bill /
 * NOC / co-applicant re-upload) that a reviewer flagged RETAKE_REQUIRED via
 * renewal-kyc-documents/[documentId]/review or a whole-batch *_RETAKE on renewal-action.
 * Swaps the file and resets only the stage(s) that flagged this document back to PENDING —
 * it does NOT touch loan.renewalApprovalStatus. The FDO then calls renewal-action's
 * FDO_RESUBMIT to push the renewal back into the approval queue.
 *
 * Deliberately not PATCH /api/loans/renewal-application's `houseDocuments`, which deletes
 * and recreates every house/QR/NOC row for the loan — fine for a full form resubmit, wrong
 * for swapping one flagged image.
 *
 * Body (multipart/form-data):
 *   file: File (required)
 *
 * @access FDO (own renewal only), ADMIN
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ loanId: string; documentId: string }> }
) {
    const { loanId, documentId } = await params;

    return withRole(['FDO', 'ADMIN'], async (req, user) => {
        try {
            const loan = await prisma.loan.findUnique({
                where: { id: loanId },
                select: {
                    id: true,
                    isRenewalApplication: true,
                    renewalApprovalStatus: true,
                    branchId: true,
                    createdById: true,
                    client: { select: { clientId: true } },
                },
            });
            if (!loan || !loan.isRenewalApplication) return errorResponse('Renewal loan not found', 404);

            // Same ownership rule as renewal-action's FDO_RESUBMIT and renewal-application PATCH.
            if (user.role === 'FDO' && loan.createdById !== user.userId) {
                return errorResponse('You can only re-upload documents on your own renewal applications', 403);
            }

            if (!RENEWAL_RECHECK_STATUSES.includes(loan.renewalApprovalStatus ?? '')) {
                return errorResponse(
                    `Renewal is not currently pending a recheck (status: ${loan.renewalApprovalStatus ?? 'none'})`,
                    400
                );
            }

            const doc = await prisma.kYC.findFirst({
                where: { id: documentId, loanId: loan.id, isDeleted: false },
            });
            if (!doc) return errorResponse('Renewal document not found', 404);

            if (!SUPPORTED_KYC_DOCUMENT_TYPE_VALUES.includes(doc.documentType as never)) {
                return errorResponse('Unsupported document type', 400);
            }

            const formData = await req.formData();
            const file = formData.get('file');
            if (!(file instanceof File)) {
                return errorResponse('File is required', 400);
            }

            const buffer = Buffer.from(await file.arrayBuffer());
            const uploadResult = await uploadKycDocument({
                fileBuffer: buffer,
                contentType: file.type || 'application/octet-stream',
                fileName: file.name,
                clientIdentifier: loan.client.clientId,
                documentType: doc.documentType as never,
                owner: doc.coApplicantId ? 'coApplicant' : 'client',
            });

            // Best-effort cleanup of the previous file — don't fail the request if this errors
            if (doc.fileUrl) {
                try {
                    const oldKey = extractFileKeyFromUrl(doc.fileUrl);
                    if (oldKey) await deleteKycDocument(oldKey);
                } catch (cleanupErr) {
                    console.error('[Renewal KYC Reupload] Failed to delete previous file:', cleanupErr);
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
            // Only reset the stage(s) that actually flagged this document.
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
                    },
                }),
                // Custom-role stages keep their decision in kyc_stage_reviews — clear their retake flag too
                prisma.kycStageReview.updateMany({
                    where: { kycId: documentId, decision: 'RETAKE_REQUIRED' },
                    data: { decision: 'PENDING', remark: null, reviewerId: null, reviewedAt: null },
                }),
                prisma.loanApprovalHistory.create({
                    data: {
                        loanId: loan.id,
                        action: 'FDO_REUPLOADED_RENEWAL_DOCUMENT',
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
            console.error('Error re-uploading renewal document:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to re-upload document',
                500
            );
        }
    })(request);
}
