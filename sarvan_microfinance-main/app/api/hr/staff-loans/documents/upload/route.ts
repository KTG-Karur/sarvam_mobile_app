import { NextRequest } from 'next/server';
import { errorResponse, handleCorsPreflight, successResponse } from '@/app/lib/api-utils';
import { canApplyForOthers, withStaffLoanActor } from '@/app/lib/staff-loans/application-access';
import { documentUploadTargetForReviewer } from '@/app/lib/staff-loans/application-service';
import { STAFF_LOAN_DOCUMENT_ALLOWED_MIME, STAFF_LOAN_DOCUMENT_MAX_BYTES, sniffMime } from '@/app/lib/staff-loans/document-rule';
import { isGcsConfigValid } from '@/app/lib/storage/gcs-client';
import { compressProofBuffer } from '@/app/lib/storage/compress-proof-file';
import { uploadStaffLoanDocument } from '@/app/lib/storage/staff-loan-document-storage';

export function OPTIONS() { return handleCorsPreflight(); }

// POST /api/hr/staff-loans/documents/upload — multipart: `file` (PDF / JPG / PNG, max 5 MB) and an
// optional `employeeId` when someone applies on an employee's behalf. Returns
// { fileKey, fileName, fileSize, mimeType } to pass as `document` when saving the application.
export function POST(request: NextRequest) {
    return withStaffLoanActor(async (req, actor) => {
        let form: FormData;
        try {
            form = await req.formData();
        } catch {
            return errorResponse('Invalid request: multipart/form-data is required with a "file" field', 400);
        }

        const file = form.get('file');
        if (!file || !(file instanceof File)) return errorResponse('A file is required (form field "file")', 400);
        if (file.size === 0) return errorResponse('The uploaded file is empty', 400);
        if (file.size > STAFF_LOAN_DOCUMENT_MAX_BYTES) return errorResponse('The file must be 5 MB or smaller', 400);

        const target = form.get('employeeId');
        const loanId = form.get('loanId');
        let employeeId = actor.userId;
        if (typeof loanId === 'string' && loanId) {
            // Approver replacing the document of a loan under their review: file goes to the borrower's folder.
            employeeId = await documentUploadTargetForReviewer(actor, loanId);
        } else if (typeof target === 'string' && target && target !== actor.userId) {
            if (!canApplyForOthers(actor)) return errorResponse('You are only authorized to apply for your own staff loan.', 403);
            employeeId = target;
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const detected = sniffMime(buffer);
        if (!detected || !(STAFF_LOAN_DOCUMENT_ALLOWED_MIME as readonly string[]).includes(detected)) {
            return errorResponse('Only PDF, JPG or PNG files are allowed', 400);
        }
        if (!isGcsConfigValid) return errorResponse('File storage is not configured on this server', 503);

        const finalBuffer = await compressProofBuffer(buffer, detected);
        const uploaded = await uploadStaffLoanDocument({ fileBuffer: finalBuffer, contentType: detected, fileName: file.name || 'document', employeeId });
        return successResponse(uploaded, 'Document uploaded', 201);
    })(request);
}
