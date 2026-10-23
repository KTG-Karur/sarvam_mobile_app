import { NextRequest } from 'next/server';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { uploadGrtSessionPhoto } from '@/app/lib/storage/grt-session-storage';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_SIZE = 8 * 1024 * 1024; // 8 MB

/**
 * POST /api/grt-sessions/[sessionId]/photos
 * Uploads a center-wise GRT photo, optionally tied to an IMAGE-type question.
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    return withRole(['BRANCH_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'], async (req, user) => {
        try {
            const { sessionId } = await params;

            const session = await prisma.grtSession.findFirst({
                where: { OR: [{ id: sessionId }, { sessionId: sessionId }] },
                select: { id: true, completedAt: true },
            });
            if (!session) return errorResponse('GRT session not found', 404);
            if (session.completedAt) return errorResponse('Cannot add photos to a completed GRT session', 400);

            const formData = await req.formData();
            const file = formData.get('photo') as File | null;
            const questionId = (formData.get('questionId') as string | null) || null;
            const notes = (formData.get('notes') as string | null) || null;

            if (!file) return errorResponse('No photo provided', 400);
            if (!ALLOWED_TYPES.includes(file.type)) return errorResponse('Only JPEG, PNG or WebP images are allowed', 400);
            if (file.size > MAX_SIZE) return errorResponse('Photo size must be under 8 MB', 400);

            const arrayBuffer = await file.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            const upload = await uploadGrtSessionPhoto({
                fileBuffer: buffer,
                contentType: file.type,
                fileName: file.name,
                sessionId: session.id,
            });

            const photo = await prisma.grtSessionPhoto.create({
                data: {
                    grtSessionId: session.id,
                    questionId,
                    photoUrl: upload.photoUrl,
                    photoKey: upload.photoKey,
                    notes,
                    uploadedById: user.userId,
                },
            });

            return successResponse({ id: photo.id, questionId: photo.questionId, photoUrl: photo.photoUrl }, 'Photo uploaded successfully');
        } catch (error: any) {
            console.error('Error uploading GRT session photo:', error);
            return errorResponse(error.message || 'Failed to upload photo', 500);
        }
    })(request);
}
