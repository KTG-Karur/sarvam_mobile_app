// ============================================================
// PUBLIC ONBOARDING DOCUMENT UPLOAD — no authentication
// app/api/public/hr-onboarding/[token]/documents/route.ts
//
// The joinee's own document uploads, gated purely by the same opaque
// publicToken as the parent app/api/public/hr-onboarding/[token] route (see
// loadValidDraft — its status === 'DRAFT' check already makes uploads
// impossible once the joinee has submitted, no extra check needed here).
// Falls under app/middleware.ts's PUBLIC_PREFIXES ('/api/public/' is a
// prefix match) automatically — no middleware change required.
// ============================================================

import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse } from '@/app/lib/api-utils';
import { loadValidDraft } from '@/app/lib/hr/onboarding-token';
import { uploadOnboardingDocument } from '@/app/lib/storage/onboarding-document-storage';
import { rateLimiter, getClientIp } from '@/app/lib/rate-limit';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const POST_LIMIT = { count: 100, windowMs: 60_000 };

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_SIZE = 5 * 1024 * 1024; // 5MB — tighter than the internal 10MB cap; this is the one truly public, unauthenticated upload surface in the app.

// Deliberately narrower than the full EmployeeDocumentCategory enum — the
// other 4 values (JOINING_KIT, APPOINTMENT_LETTER, BGV_REPORT,
// ORIGINAL_CERTIFICATE_ACK) are things HR issues TO the employee, not things
// a joinee would self-upload.
const PUBLIC_CATEGORIES = ['KYC', 'RESUME', 'EDUCATION_CERTIFICATE', 'PRE_APPLICATION_ASSESSMENT', 'BANK_PASSBOOK', 'RELIEVING_LETTER_PAYSLIP'];

// POST /api/public/hr-onboarding/[token]/documents
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
    try {
        const { token } = await params;
        const ip = getClientIp(request);
        if (!(await rateLimiter.check(`hr-onboarding-doc:post:${token}:${ip}`, POST_LIMIT.count, POST_LIMIT.windowMs))) {
            return errorResponse('Too many requests. Please wait a moment and try again.', 429);
        }
        const result = await loadValidDraft(token);
        if (!result.ok) return errorResponse(result.error, 410);

        const formData = await request.formData();
        const file = formData.get('file') as File | null;
        const category = formData.get('category') as string | null;
        const subtype = (formData.get('subtype') as string | null) || null;

        if (!file) return errorResponse('No file provided', 400);
        if (!category || !PUBLIC_CATEGORIES.includes(category)) {
            return errorResponse(`category must be one of: ${PUBLIC_CATEGORIES.join(', ')}`, 400);
        }
        if (!ALLOWED_TYPES.includes(file.type)) {
            return errorResponse('Only JPEG, PNG, WebP or PDF files are allowed', 400);
        }
        if (file.size > MAX_SIZE) {
            return errorResponse('File size must be under 5 MB', 400);
        }

        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const uploadResult = await uploadOnboardingDocument({
            fileBuffer: buffer,
            contentType: file.type,
            fileName: file.name,
            onboardingRequestId: result.request.id,
            category,
            subtype,
        });

        const document = await prisma.onboardingDocument.create({
            data: {
                onboardingRequestId: result.request.id,
                category: category as any,
                subtype,
                fileUrl: uploadResult.fileUrl,
                fileName: uploadResult.fileName,
                fileSize: uploadResult.fileSize,
                mimeType: uploadResult.mimeType,
                uploaderType: 'JOINEE',
                uploadedById: null,
                uploadedByName: result.request.employeeName || 'Joinee',
            },
            select: { id: true, category: true, subtype: true, fileName: true, uploaderType: true, status: true },
        });

        return successResponse(document, 'Document uploaded successfully', 201);
    } catch (error: any) {
        console.error('Error uploading onboarding document (public):', error);
        return errorResponse(error.message || 'Failed to upload document', 500);
    }
}
