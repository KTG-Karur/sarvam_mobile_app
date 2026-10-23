import { NextRequest } from 'next/server';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/grt-sessions/[sessionId]
 * Full detail: selected members, questionnaire + questions, answers, photos.
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    return withRole(['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'], async (req) => {
        try {
            const { sessionId } = await params;

            const session = await prisma.grtSession.findFirst({
                where: { OR: [{ id: sessionId }, { sessionId: sessionId }] },
                include: {
                    center: { select: { name: true, code: true } },
                    clients: {
                        include: {
                            client: { select: { id: true, clientId: true, firstName: true, lastName: true } },
                            loan: { select: { id: true, loanNumber: true } },
                        },
                    },
                    questionnaire: {
                        include: {
                            questions: {
                                where: { isActive: true },
                                orderBy: { priorityOrder: 'asc' },
                                include: { choices: { where: { isActive: true }, orderBy: { createdAt: 'asc' } } },
                            },
                        },
                    },
                    answers: true,
                    photos: true,
                },
            });
            if (!session) return errorResponse('GRT session not found', 404);

            return successResponse({
                id: session.id,
                sessionId: session.sessionId,
                sessionDate: session.sessionDate.toISOString().split('T')[0],
                centerName: session.center.name,
                centerCode: session.center.code,
                isComplete: !!session.completedAt,
                completedAt: session.completedAt,
                members: session.clients.map((c) => ({
                    id: c.client.id, clientId: c.client.clientId,
                    name: `${c.client.firstName} ${c.client.lastName}`.trim(),
                    loanId: c.loan.id, loanNumber: c.loan.loanNumber,
                })),
                questionnaire: {
                    id: session.questionnaire.id,
                    title: session.questionnaire.title,
                    questions: session.questionnaire.questions.map((q) => ({
                        id: q.id, question: q.question, questionType: q.questionType, priorityOrder: q.priorityOrder,
                        choices: q.choices.map((c) => ({ id: c.id, choice: c.choice })),
                    })),
                },
                answers: session.answers.map((a) => ({
                    questionId: a.questionId, answerText: a.answerText, answerBool: a.answerBool, answerChoiceIds: a.answerChoiceIds,
                })),
                photos: session.photos.map((p) => ({ id: p.id, questionId: p.questionId, photoUrl: p.photoUrl, notes: p.notes, createdAt: p.createdAt })),
            }, 'GRT session retrieved successfully');
        } catch (error: any) {
            console.error('Error fetching GRT session:', error);
            return errorResponse(error.message || 'Failed to fetch GRT session', 500);
        }
    })(request);
}

/**
 * DELETE /api/grt-sessions/[sessionId]
 * Only allowed before the session is completed.
 */
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    return withRole(['BRANCH_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'], async () => {
        try {
            const { sessionId } = await params;

            const session = await prisma.grtSession.findFirst({
                where: { OR: [{ id: sessionId }, { sessionId: sessionId }] },
                select: { id: true, completedAt: true },
            });
            if (!session) return errorResponse('GRT session not found', 404);
            if (session.completedAt) return errorResponse('Cannot delete a completed GRT session', 400);

            await prisma.grtSession.delete({ where: { id: session.id } });
            return successResponse({ id: session.id }, 'GRT session deleted');
        } catch (error: any) {
            console.error('Error deleting GRT session:', error);
            return errorResponse(error.message || 'Failed to delete GRT session', 500);
        }
    })(request);
}
