import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { uploadInsuranceDocument } from '@/app/lib/storage/insurance-storage';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * POST /api/reports/others/insurance-report/upload
 * Upload a PDF document and attach it to an existing insurance record.
 * Expects FormData with 'file' (PDF) and 'recordId' fields.
 */
export async function POST(request: NextRequest) {
    return withRole(['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'], async (req, user) => {
        try {
            const formData = await req.formData();
            const file = formData.get('file') as File | null;
            const recordId = formData.get('recordId') as string | null;

            if (!file) return errorResponse('PDF file is required', 400);
            if (!recordId) return errorResponse('Insurance record ID is required', 400);

            // Validate file type
            if (!file.type.includes('pdf')) {
                return errorResponse('Only PDF files are accepted', 400);
            }

            // Max 10MB
            if (file.size > 10 * 1024 * 1024) {
                return errorResponse('File size must be under 10MB', 400);
            }

            // Verify record exists
            const record = await prisma.insuranceRecord.findUnique({
                where: { id: recordId, isActive: true },
            });
            if (!record) return errorResponse('Insurance record not found', 404);

            // Branch access guard — role-agnostic; any branch the user is assigned to
            // (UserBranchAssignment / AreaManagerBranch), not just their primary/active branch.
            {
                const permittedBranchIds = await getPermittedBranchIds(user);
                if (permittedBranchIds !== null && !permittedBranchIds.includes(record.branchId)) {
                    return errorResponse('Access denied to this record', 403);
                }
            }

            // Convert File to Buffer
            const arrayBuffer = await file.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            // Upload to GCS
            const result = await uploadInsuranceDocument({
                fileBuffer: buffer,
                contentType: file.type,
                fileName: file.name,
                clientId: record.clientId,
                policyNumber: record.policyNumber,
            });

            // Update the insurance record with the document URL
            await prisma.insuranceRecord.update({
                where: { id: recordId },
                data: {
                    documentUrl: result.fileUrl,
                    documentKey: result.fileKey,
                    documentName: result.fileName,
                },
            });

            return successResponse(
                {
                    documentUrl: result.fileUrl,
                    fileName: result.fileName,
                    fileSize: result.fileSize,
                },
                'Insurance document uploaded successfully'
            );
        } catch (error: any) {
            console.error('[Insurance Upload] Error:', error);
            return errorResponse(
                error.message || 'Failed to upload insurance document',
                500
            );
        }
    })(request);
}
