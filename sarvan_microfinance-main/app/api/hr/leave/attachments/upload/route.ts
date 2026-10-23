import { NextRequest } from 'next/server';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { canActorApplyForEmployee, isUserContext } from '@/app/lib/permissions/guards';
import { isGcsConfigValid } from '@/app/lib/storage/gcs-client';
import { uploadLeaveProof } from '@/app/lib/storage/leave-proof-storage';
import { LEAVE_PROOF_ALLOWED_MIME, LEAVE_PROOF_MAX_BYTES, sniffMime } from '@/app/lib/leave-attachment-rule';
import sharp from 'sharp';
import { PDFDocument } from 'pdf-lib';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// POST /api/hr/leave/attachments/upload — multipart: `file` (PDF / JPG / PNG, max 5 MB) and an
// optional `employeeId` when a manager applies on someone's behalf. Step 1 of applying with proof:
// returns { fileKey, fileName, fileSize, mimeType } to pass in `attachments` of POST /hr/leave/apply.
export async function POST(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            let form: FormData;
            try {
                form = await req.formData();
            } catch {
                return errorResponse('Invalid request: multipart/form-data is required with a "file" field', 400);
            }

            const file = form.get('file');
            const targetParam = form.get('employeeId');

            if (!file || !(file instanceof File)) {
                return errorResponse('A file is required (form field "file")', 400);
            }
            if (file.size === 0) {
                return errorResponse('The uploaded file is empty', 400);
            }
            if (file.size > LEAVE_PROOF_MAX_BYTES) {
                return errorResponse('Each file must be 5 MB or smaller', 400);
            }

            let targetEmployeeId = user.userId;
            if (typeof targetParam === 'string' && targetParam && targetParam !== user.userId) {
                const authRes = await canActorApplyForEmployee(req, targetParam, '/dashboard/hr/leave/apply');
                if (!isUserContext(authRes)) return authRes;
                targetEmployeeId = targetParam;
            }

            const buffer = Buffer.from(await file.arrayBuffer());
            const detected = sniffMime(buffer);
            if (!detected || !(LEAVE_PROOF_ALLOWED_MIME as readonly string[]).includes(detected)) {
                return errorResponse('Only PDF, JPG or PNG files are allowed', 400);
            }

            // Strict Cloud Storage check — no local fallback.
            if (!isGcsConfigValid) {
                return errorResponse('File storage is not configured on this server', 503);
            }

            // Server-side compression:
            // 1. Images (JPEG / PNG): sharp resizes (max 1600x1600) and compresses while preserving crisp text.
            // 2. PDFs: pdf-lib re-encodes and strips redundant streams using object stream compression.
            let finalBuffer: Buffer = buffer;
            if (detected === 'image/jpeg') {
                try {
                    const compressed = await sharp(buffer)
                        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
                        .jpeg({ quality: 80, progressive: true })
                        .toBuffer();
                    finalBuffer = Buffer.from(compressed);
                } catch (compressionErr) {
                    console.warn('[Leave Proof Upload] JPEG compression failed, keeping original:', compressionErr);
                }
            } else if (detected === 'image/png') {
                try {
                    const compressed = await sharp(buffer)
                        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
                        .png({ compressionLevel: 8 })
                        .toBuffer();
                    finalBuffer = Buffer.from(compressed);
                } catch (compressionErr) {
                    console.warn('[Leave Proof Upload] PNG compression failed, keeping original:', compressionErr);
                }
            } else if (detected === 'application/pdf') {
                try {
                    const pdfDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
                    const compressedBytes = await pdfDoc.save({
                        useObjectStreams: true,
                        addDefaultPage: false,
                        objectsPerTick: 50,
                    });
                    const compressedBuffer = Buffer.from(compressedBytes);
                    if (compressedBuffer.byteLength <= buffer.byteLength) {
                        finalBuffer = compressedBuffer;
                    }
                } catch (pdfErr) {
                    console.warn('[Leave Proof Upload] PDF compression failed, keeping original:', pdfErr);
                }
            }

            const uploaded = await uploadLeaveProof({ fileBuffer: finalBuffer, contentType: detected, fileName: file.name || 'proof', employeeId: targetEmployeeId });
            return successResponse(uploaded, 'Proof uploaded', 201);
        } catch (error: any) {
            console.error('Error uploading leave proof:', error);
            return errorResponse(error.message || 'Failed to upload proof', 500);
        }
    })(request);
}
