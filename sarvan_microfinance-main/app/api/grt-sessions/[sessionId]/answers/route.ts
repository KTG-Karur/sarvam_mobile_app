import { NextRequest } from 'next/server';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { z } from 'zod';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const answerSchema = z.object({
    questionId: z.string().min(1),
    answerText: z.string().nullable().optional(),
    answerBool: z.boolean().nullable().optional(),
    answerChoiceIds: z.array(z.string()).default([]),
});
const schema = z.object({ answers: z.array(answerSchema).min(1) });

/**
 * PATCH /api/grt-sessions/[sessionId]/answers
 * Batch-upserts the group's answers for this session.
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    return withRole(['BRANCH_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'], async (req, user) => {
        try {
            const { sessionId } = await params;
            const body = await req.json();
            const { answers } = schema.parse(body);

            const session = await prisma.grtSession.findFirst({
                where: { OR: [{ id: sessionId }, { sessionId: sessionId }] },
                select: { id: true, completedAt: true },
            });
            if (!session) return errorResponse('GRT session not found', 404);
            if (session.completedAt) return errorResponse('Cannot change answers of a completed GRT session', 400);

            await Promise.all(
                answers.map((a) =>
                    prisma.grtSessionAnswer.upsert({
                        where: { grtSessionId_questionId: { grtSessionId: session.id, questionId: a.questionId } },
                        create: {
                            grtSessionId: session.id,
                            questionId: a.questionId,
                            answerText: a.answerText ?? null,
                            answerBool: a.answerBool ?? null,
                            answerChoiceIds: a.answerChoiceIds,
                            answeredById: user.userId,
                        },
                        update: {
                            answerText: a.answerText ?? null,
                            answerBool: a.answerBool ?? null,
                            answerChoiceIds: a.answerChoiceIds,
                            answeredById: user.userId,
                        },
                    })
                )
            );

            const saved = await prisma.grtSessionAnswer.findMany({ where: { grtSessionId: sessionId } });
            return successResponse(
                saved.map((a) => ({ questionId: a.questionId, answerText: a.answerText, answerBool: a.answerBool, answerChoiceIds: a.answerChoiceIds })),
                'Answers saved'
            );
        } catch (error: any) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            console.error('Error saving GRT session answers:', error);
            return errorResponse(error.message || 'Failed to save answers', 500);
        }
    })(request);
}
