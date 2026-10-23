import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withRole, errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { uploadKycDocument, deleteKycDocument, extractFileKeyFromUrl } from '@/app/lib/storage/kyc-storage';
import { prisma } from '@/app/lib/prisma';
import { SUPPORTED_KYC_DOCUMENT_TYPE_VALUES, resolveKycUploadOwner } from '@/app/lib/kyc-document-types';
import { buildKycResetData } from '@/app/lib/kyc-verification';
import { isSubAdminUser } from '@/app/lib/permissions/sub-admin';
import { getAllowFdoEditApprovedClient } from '@/app/lib/fdo-approved-client-edit-config';
import { getAllowBmEditApprovedClient } from '@/app/lib/bm-approved-client-edit-config';

export const runtime = 'nodejs';

const uploadSchema = z.object({
    clientId: z.string().min(1, 'Client identifier is required'),
    documentType: z.enum(SUPPORTED_KYC_DOCUMENT_TYPE_VALUES, {
        errorMap: () => ({
            message: 'Invalid document type',
        }),
    }),
    isEnrollment: z.boolean().optional(), // Flag to indicate if this is during enrollment
    owner: z.enum(['client', 'nominee', 'coApplicant'], {
        errorMap: () => ({
            message: "owner (or entityType) must be 'client', 'nominee', or 'coApplicant'",
        }),
    }).optional(),
    category: z.enum(['kyc', 'photos', 'nominee']).optional(),
    // Which specific co-applicant this document belongs to — a client can have
    // multiple co-applicants, so documentType alone no longer identifies the
    // right record to replace when owner === 'coApplicant'.
    coApplicantId: z.string().optional(),
});

/** FormData.get returns `null` when absent; Zod `.optional()` only treats `undefined` as missing. */
function formDataOptionalString(value: FormDataEntryValue | null): string | undefined {
    if (value === null || value === '') {
        return undefined;
    }
    return String(value);
}

export async function OPTIONS() {
    return handleCorsPreflight();
}

export async function POST(request: NextRequest) {
    return withRole(['FDO', 'BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN'], async (req, user) => {
        try {
            const formData = await req.formData();

            const clientId = formData.get('clientId');
            const documentType = formData.get('documentType');
            const isEnrollment = formData.get('isEnrollment') === 'true';
            const ownerRaw = formData.get('owner') ?? formData.get('entityType');
            const categoryRaw = formData.get('category');
            const coApplicantIdRaw = formData.get('coApplicantId');
            const file = formData.get('file');

            const validationResult = uploadSchema.safeParse({
                clientId: clientId === null || clientId === '' ? undefined : String(clientId),
                documentType: documentType === null || documentType === '' ? undefined : String(documentType),
                isEnrollment,
                owner: formDataOptionalString(ownerRaw),
                category: formDataOptionalString(categoryRaw),
                coApplicantId: formDataOptionalString(coApplicantIdRaw),
            });

            if (!validationResult.success) {
                const firstError = validationResult.error.errors[0]?.message ?? 'Invalid upload parameters';
                return errorResponse(firstError, 400);
            }

            if (!(file instanceof File)) {
                return errorResponse('File is required', 400);
            }

            // Upload file to S3 first (this works regardless of client existence)
            const buffer = Buffer.from(await file.arrayBuffer());

            const uploadResult = await uploadKycDocument({
                fileBuffer: buffer,
                contentType: file.type || 'application/octet-stream',
                fileName: file.name,
                clientIdentifier: validationResult.data.clientId,
                documentType: validationResult.data.documentType,
                owner: validationResult.data.owner,
                category: validationResult.data.category,
            });

            // If this is during enrollment, just return the upload result
            // The KYC record will be created when the client is enrolled
            if (isEnrollment) {
                return successResponse(
                    {
                        ...uploadResult,
                        uploadedById: user.userId,
                        isEnrollment: true,
                    },
                    'KYC document uploaded successfully (enrollment mode)',
                );
            }

            // For existing clients, find the client and create/update KYC record.
            // findFirst, not findUnique — Client.clientId isn't DB-unique (uploan-imported
            // legacy IDs can intentionally collide, see schema.prisma) — deterministic
            // oldest-created tiebreak, matching every other clientId lookup in the app
            // (e.g. app/api/clients/[clientId]/kyc-documents/route.ts). Without this, a
            // duplicated clientId could resolve to the wrong client on each request and
            // silently attach the upload to someone else's record.
            const client = await prisma.client.findFirst({
                where: {
                    OR: [
                        { id: validationResult.data.clientId },
                        { clientId: validationResult.data.clientId },
                    ],
                },
                orderBy: { createdAt: 'asc' },
                select: { id: true, approvalStatus: true },
            });

            if (!client) {
                // If client not found but we have the file uploaded, return success with a warning
                console.warn('[KYC Upload] Client not found, but file uploaded to S3');
                return successResponse(
                    {
                        ...uploadResult,
                        uploadedById: user.userId,
                        warning: 'File uploaded but client not found. KYC record will be created during enrollment.',
                    },
                    'KYC document uploaded successfully',
                );
            }

            const { coApplicantId } = validationResult.data;
            const owner = resolveKycUploadOwner({
                documentType: validationResult.data.documentType,
                explicitOwner: validationResult.data.owner,
            });

            // Find existing KYC documents to replace — scoped to the specific
            // co-applicant when this doc belongs to one (a client can have
            // several co-applicants, each with their own document of the same type).
            const existingDocs = await prisma.kYC.findMany({
                where: {
                    clientId: client.id,
                    documentType: validationResult.data.documentType,
                    coApplicantId: owner === 'coApplicant' ? (coApplicantId ?? null) : null,
                },
                select: {
                    id: true,
                    fileUrl: true,
                },
            });

            // Delete old files from S3 and database records
            for (const doc of existingDocs) {
                try {
                    // Delete from S3 if fileUrl exists
                    if (doc.fileUrl) {
                        const fileKey = extractFileKeyFromUrl(doc.fileUrl);
                        if (fileKey) {
                            await deleteKycDocument(fileKey);
                        }
                    }
                    // Delete database record
                    await prisma.kYC.delete({
                        where: { id: doc.id },
                    });
                } catch (deleteError) {
                    // Log error but continue with upload
                    console.error(`Error deleting old document ${doc.id}:`, deleteError);
                }
            }

            // Create new database record
            await prisma.kYC.create({
                data: {
                    clientId: client.id,
                    coApplicantId: owner === 'coApplicant' ? (coApplicantId ?? null) : null,
                    documentType: validationResult.data.documentType,
                    documentNumber: null,
                    fileUrl: uploadResult.fileUrl,
                    fileName: uploadResult.fileName,
                    fileSize: uploadResult.fileSize,
                    mimeType: uploadResult.mimeType,
                    uploadedById: user.userId,
                    status: 'PENDING_VERIFICATION',
                },
            });

            // Co-applicant documents no longer affect the client's own KYC/approval
            // status — co-applicant approval is its own independent BM->AM->QC->Admin
            // workflow now, gated separately (see /api/co-applicants/[id]/action).
            // Also skip the reset when an Admin/Sub Admin/Branch Manager/FDO
            // re-uploads a document on an already-APPROVED client — their own
            // correction shouldn't re-queue the client for BM -> AM -> QC -> Admin
            // again.
            if (owner !== 'coApplicant') {
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

            console.log('[KYC Upload] KYC record created for client:', client.id);

            return successResponse(
                {
                    ...uploadResult,
                    uploadedById: user.userId,
                },
                'KYC document uploaded successfully',
            );
        } catch (error) {
            console.error('[KYC Upload] Error:', error);
            const message = error instanceof Error ? error.message : 'Failed to upload KYC document';
            return errorResponse(message, 500);
        }
    })(request);
}
