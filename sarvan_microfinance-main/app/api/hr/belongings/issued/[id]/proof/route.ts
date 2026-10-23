import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { requirePermission, isUserContext, isEmployeeInCallerScope } from '@/app/lib/permissions/guards';
import { isGcsConfigValid } from '@/app/lib/storage/gcs-client';
import { uploadBelongingReturnProof } from '@/app/lib/storage/belonging-return-storage';
import { compressProofBuffer } from '@/app/lib/storage/compress-proof-file';
import { sniffMime } from '@/app/lib/leave-attachment-rule';
import { BELONGING_PROOF_MAX_BYTES } from '@/app/lib/hr/belonging-return-rules';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// POST /api/hr/belongings/issued/[id]/proof — multipart: `file` (JPG / PNG,
// max 5 MB). Step 1 of returning a belonging: uploads one photo of the item
// into this belonging's own folder and returns
// { fileKey, fileName, fileSize, mimeType } to pass in `photos` of
// POST .../return, which is what actually records it.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requirePermission(request, 'hr-employee', 'edit');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { id } = await params;
        const existing = await prisma.employeeIssuedBelonging.findUnique({
            where: { id },
            select: { employeeId: true, status: true, employee: { select: { branchId: true } } },
        });
        if (!existing) return errorResponse('Issued belonging record not found', 404);
        if (!(await isEmployeeInCallerScope(ctx, existing.employee.branchId))) {
            return errorResponse('You do not have access to this employee', 403);
        }
        if (existing.status !== 'ISSUED') {
            return errorResponse('This item has already been returned/closed', 409);
        }

        let form: FormData;
        try {
            form = await request.formData();
        } catch {
            return errorResponse('Invalid request: multipart/form-data is required with a "file" field', 400);
        }
        const file = form.get('file');
        if (!file || !(file instanceof File)) return errorResponse('A file is required (form field "file")', 400);
        if (file.size === 0) return errorResponse('The uploaded file is empty', 400);
        if (file.size > BELONGING_PROOF_MAX_BYTES) return errorResponse('Each file must be 5 MB or smaller', 400);

        const buffer = Buffer.from(await file.arrayBuffer());
        const detected = sniffMime(buffer);
        if (detected !== 'image/jpeg' && detected !== 'image/png') {
            return errorResponse('Only JPG or PNG photos are allowed', 400);
        }

        if (!isGcsConfigValid) return errorResponse('File storage is not configured on this server', 503);

        const finalBuffer = await compressProofBuffer(buffer, detected);
        const uploaded = await uploadBelongingReturnProof({
            fileBuffer: finalBuffer,
            contentType: detected,
            fileName: file.name,
            employeeId: existing.employeeId,
            issuedBelongingId: id,
        });

        return successResponse(
            { fileKey: uploaded.fileKey, fileName: file.name, fileSize: uploaded.fileSize, mimeType: detected },
            'Photo uploaded'
        );
    } catch (error: unknown) {
        console.error('Error uploading belonging return proof:', error);
        return errorResponse(error instanceof Error ? error.message : 'Failed to upload proof', 500);
    }
}
