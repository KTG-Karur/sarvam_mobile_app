import { NextRequest } from 'next/server';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { uploadEmployeeDocument, type EmployeeDocType } from '@/app/lib/storage/employee-storage';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const VALID_DOC_TYPES: EmployeeDocType[] = ['aadhaar', 'pan', 'profile', 'esi_pf', 'location'];

export async function OPTIONS() {
    return handleCorsPreflight();
}

export async function POST(request: NextRequest) {
    return withAuth(async () => {
        try {
            const formData = await request.formData();
            const file = formData.get('file') as File | null;
            const docType = formData.get('docType') as string | null;
            const employeeId = (formData.get('employeeId') as string | null) ?? 'unknown';

            if (!file) return errorResponse('No file provided', 400);
            if (!docType || !VALID_DOC_TYPES.includes(docType as EmployeeDocType)) {
                return errorResponse(`docType must be one of: ${VALID_DOC_TYPES.join(', ')}`, 400);
            }
            if (!ALLOWED_TYPES.includes(file.type)) {
                return errorResponse('Only JPEG, PNG, WebP or PDF files are allowed', 400);
            }
            if (file.size > MAX_SIZE) {
                return errorResponse('File size must be under 5 MB', 400);
            }

            const arrayBuffer = await file.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            const result = await uploadEmployeeDocument({
                fileBuffer: buffer,
                contentType: file.type,
                fileName: file.name,
                employeeId,
                docType: docType as EmployeeDocType,
            });

            return successResponse({ url: result.fileUrl, key: result.fileKey }, 'Document uploaded successfully');
        } catch (error: any) {
            console.error('Employee document upload error:', error);
            return errorResponse(error.message || 'Upload failed', 500);
        }
    })(request);
}
