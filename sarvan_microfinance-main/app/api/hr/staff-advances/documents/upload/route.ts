import { NextRequest } from 'next/server';
import { errorResponse, handleCorsPreflight, successResponse } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/db';
import { withStaffLoanActor } from '@/app/lib/staff-loans/application-access';
import { STAFF_LOAN_DOCUMENT_ALLOWED_MIME, STAFF_LOAN_DOCUMENT_MAX_BYTES, sniffMime } from '@/app/lib/staff-loans/document-rule';
import { advanceCanApplyForOthers } from '@/app/lib/staff-advances/access';
import { advanceDocumentUploadTargetForReviewer } from '@/app/lib/staff-advances/service';
import { isGcsConfigValid } from '@/app/lib/storage/gcs-client';
import { compressProofBuffer } from '@/app/lib/storage/compress-proof-file';
import { uploadStaffLoanDocument } from '@/app/lib/storage/staff-loan-document-storage';

export function OPTIONS() { return handleCorsPreflight(); }

// POST /api/hr/staff-advances/documents/upload — multipart: `file` (PDF / JPG / PNG, max 5 MB) and an optional
// `employeeId` when someone applies on an employee's behalf, or `advanceId` when the current-stage approver replaces
// the file of an advance under their review. Same rules as the Staff Loan upload. Returns
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
        const advanceId = form.get('advanceId');
        let employeeId = actor.userId;
        if (typeof advanceId === 'string' && advanceId) {
            employeeId = await advanceDocumentUploadTargetForReviewer(actor, advanceId);
        } else if (typeof target === 'string' && target && target !== actor.userId) {
            if (!advanceCanApplyForOthers(actor)) return errorResponse('You are only authorized to apply for your own staff advance.', 403);
            if (actor.branchIds !== null) {
                // The applicant must be inside the branches this user may act for, exactly as when the advance is submitted.
                const employee = await prisma.user.findUnique({ where: { id: target }, select: { branchId: true } });
                if (!employee?.branchId || !actor.branchIds.includes(employee.branchId)) return errorResponse('Selected employee is outside your permitted branch scope.', 403);
            }
            employeeId = target;
        }

        const buffer = Buffer.from(await file.arrayBuffer());
        const detected = sniffMime(buffer);
        if (!detected || !(STAFF_LOAN_DOCUMENT_ALLOWED_MIME as readonly string[]).includes(detected)) {
            return errorResponse('Only PDF, JPG or PNG files are allowed', 400);
        }
        if (!isGcsConfigValid) return errorResponse('File storage is not configured on this server', 503);

        const finalBuffer = await compressProofBuffer(buffer, detected);
        const uploaded = await uploadStaffLoanDocument({ fileBuffer: finalBuffer, contentType: detected, fileName: file.name || 'document', employeeId, kind: 'staff-advance' });
        return successResponse(uploaded, 'Document uploaded', 201);
    })(request);
}
