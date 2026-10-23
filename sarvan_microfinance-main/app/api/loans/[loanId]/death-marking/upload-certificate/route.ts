import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { uploadDeathCertificate } from '@/app/lib/storage/death-certificate-storage';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ loanId: string }> }
) {
    return withRole(['ADMIN', 'BRANCH_MANAGER'], async (req) => {
        try {
            const { loanId } = await params;
            if (!loanId) return errorResponse('Loan ID is required', 400);

            const formData = await req.formData();
            const file = formData.get('file') as File | null;

            if (!file) return errorResponse('File is required', 400);

            if (!ALLOWED_MIME_TYPES.includes(file.type)) {
                return errorResponse('Only PDF, JPEG, and PNG files are accepted', 400);
            }

            if (file.size > MAX_FILE_SIZE) {
                return errorResponse('File size must be under 10 MB', 400);
            }

            const arrayBuffer = await file.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            const result = await uploadDeathCertificate({
                fileBuffer: buffer,
                contentType: file.type,
                fileName: file.name,
                loanId,
            });

            return successResponse(
                { fileUrl: result.fileUrl, fileName: result.fileName, fileKey: result.fileKey },
                'Death certificate uploaded successfully'
            );
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to upload certificate';
            return errorResponse(message, 500);
        }
    })(request);
}
