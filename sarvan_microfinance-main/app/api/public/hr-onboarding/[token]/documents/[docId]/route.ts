// ============================================================
// PUBLIC ONBOARDING DOCUMENT REMOVAL — no authentication
// app/api/public/hr-onboarding/[token]/documents/[docId]/route.ts
// ============================================================

import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse } from '@/app/lib/api-utils';
import { loadValidDraft } from '@/app/lib/hr/onboarding-token';
import { deleteOnboardingDocument } from '@/app/lib/storage/onboarding-document-storage';
import { rateLimiter, getClientIp } from '@/app/lib/rate-limit';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const DELETE_LIMIT = { count: 100, windowMs: 60_000 };

// DELETE /api/public/hr-onboarding/[token]/documents/[docId] — the joinee
// may only remove their own upload (uploaderType JOINEE), and only while the
// request is still DRAFT (loadValidDraft enforces this).
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ token: string; docId: string }> }) {
    try {
        const { token, docId } = await params;
        const ip = getClientIp(request);
        if (!(await rateLimiter.check(`hr-onboarding-doc:delete:${token}:${ip}`, DELETE_LIMIT.count, DELETE_LIMIT.windowMs))) {
            return errorResponse('Too many requests. Please wait a moment and try again.', 429);
        }
        const result = await loadValidDraft(token);
        if (!result.ok) return errorResponse(result.error, 410);

        const document = await prisma.onboardingDocument.findUnique({ where: { id: docId } });
        if (!document || document.onboardingRequestId !== result.request.id || document.uploaderType !== 'JOINEE') {
            return errorResponse('Document not found', 404);
        }

        await deleteOnboardingDocument(document.fileUrl);
        await prisma.onboardingDocument.delete({ where: { id: docId } });

        return successResponse(null, 'Document removed');
    } catch (error: any) {
        console.error('Error deleting onboarding document (public):', error);
        return errorResponse(error.message || 'Failed to delete document', 500);
    }
}
