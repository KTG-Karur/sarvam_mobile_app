import { NextRequest } from 'next/server';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * PATCH /api/grt-sessions/[sessionId]/complete
 * Validates every active question in the questionnaire has an answer
 * (IMAGE questions need at least one uploaded photo) before marking complete.
 * Once complete, every member in this session satisfies the GRT part of
 * their disbursement gate.
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    return withRole(['BRANCH_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'], async (req, user) => {
        try {
            const { sessionId } = await params;

            const session = await prisma.grtSession.findFirst({
                where: { OR: [{ id: sessionId }, { sessionId: sessionId }] },
                include: { answers: true, photos: true, clients: true },
            });
            if (!session) return errorResponse('GRT session not found', 404);
            if (session.completedAt) return errorResponse('Session is already complete', 400);
            if (session.clients.length === 0) return errorResponse('Select at least one member before completing', 400);

            const questions = await prisma.question.findMany({
                where: { questionnaireId: session.questionnaireId, isActive: true },
                select: { id: true, questionType: true },
            });

            const answeredIds = new Set(session.answers.map((a) => a.questionId));
            const photoQuestionIds = new Set(session.photos.map((p) => p.questionId).filter(Boolean));

            const unanswered = questions.filter((q) =>
                q.questionType === 'IMAGE' ? !photoQuestionIds.has(q.id) : !answeredIds.has(q.id)
            );
            if (unanswered.length > 0) {
                return errorResponse(`Answer all questions before completing — ${unanswered.length} remaining`, 400);
            }

            const updated = await prisma.grtSession.update({
                where: { id: session.id },
                data: { completedAt: new Date(), completedById: user.userId },
            });

            return successResponse({ completedAt: updated.completedAt }, 'GRT session marked complete');
        } catch (error: any) {
            console.error('Error completing GRT session:', error);
            return errorResponse(error.message || 'Failed to complete GRT session', 500);
        }
    })(request);
}
