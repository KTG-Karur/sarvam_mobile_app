import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { uploadClosureApprovalDocument } from '@/app/lib/storage/closure-approval-storage';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * POST /api/collections/loan-writeoff-closure/upload-approval-doc
 * Upload an HO Approval Document for a loan write-off / death closure.
 * Returns { fileUrl, fileName, fileKey } — caller includes these in the closure POST body.
 * FormData fields: file (PDF/JPG/PNG), loanId (string)
 */
export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const formData = await req.formData();
            const file = formData.get('file') as File | null;
            const loanId = formData.get('loanId') as string | null;

            if (!file) return errorResponse('File is required', 400);
            if (!loanId) return errorResponse('Loan ID is required', 400);

            if (!ALLOWED_MIME_TYPES.includes(file.type)) {
                return errorResponse('Only PDF, JPEG, and PNG files are accepted', 400);
            }

            if (file.size > MAX_FILE_SIZE) {
                return errorResponse('File size must be under 10 MB', 400);
            }

            const arrayBuffer = await file.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            const result = await uploadClosureApprovalDocument({
                fileBuffer: buffer,
                contentType: file.type,
                fileName: file.name,
                loanId,
            });

            return successResponse(
                { fileUrl: result.fileUrl, fileName: result.fileName, fileKey: result.fileKey },
                'Approval document uploaded successfully'
            );
        } catch (error: unknown) {
            console.error('[ClosureApprovalUpload] Error:', error);
            const message = error instanceof Error ? error.message : 'Failed to upload document';
            return errorResponse(message, 500);
        }
    })(request);
}
