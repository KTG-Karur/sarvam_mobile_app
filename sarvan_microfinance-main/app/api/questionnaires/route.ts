import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// GET /api/questionnaires
export async function GET(request: NextRequest) {
    return withRole(['ADMIN', 'BRANCH_MANAGER', 'FDO', 'AREA_MANAGER', 'QC', 'DIVISION_MANAGER'], async () => {
        try {
            const { searchParams } = new URL(request.url);
            const id = searchParams.get('id');
            const search = searchParams.get('search');

            if (id) {
                const questionnaire = await prisma.questionnaire.findUnique({
                    where: { id },
                    include: {
                        questions: {
                            where: { isActive: true },
                            orderBy: { priorityOrder: 'asc' },
                            include: {
                                choices: {
                                    where: { isActive: true },
                                    orderBy: { createdAt: 'asc' },
                                },
                            },
                        },
                    },
                });

                if (!questionnaire) {
                    return errorResponse('Questionnaire not found', 404);
                }

                return successResponse(questionnaire, 'Questionnaire fetched successfully');
            }

            const whereClause: Record<string, unknown> = { isActive: true };
            if (search) {
                whereClause.OR = [
                    { title: { contains: search, mode: 'insensitive' } },
                    { description: { contains: search, mode: 'insensitive' } },
                ];
            }

            const questionnaires = await prisma.questionnaire.findMany({
                where: whereClause,
                orderBy: { createdAt: 'desc' },
                include: {
                    _count: { select: { questions: { where: { isActive: true } } } },
                },
            });

            return successResponse(questionnaires, 'Questionnaires fetched successfully');
        } catch (error) {
            console.error('Error fetching questionnaires:', error);
            return errorResponse('Failed to fetch questionnaires', 500);
        }
    })(request);
}

// POST /api/questionnaires
export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async () => {
        try {
            const body = await request.json();

            if (!body.title?.trim()) {
                return errorResponse('Questionnaire title is required', 400);
            }

            if (!body.questions || body.questions.length === 0) {
                return errorResponse('At least one question is required', 400);
            }

            // Generate questionnaire ID
            const existingQuestionnaires = await prisma.questionnaire.findMany({
                select: { questionnaireId: true },
                orderBy: { createdAt: 'desc' },
            });

            let nextNumber = 1;
            if (existingQuestionnaires.length > 0) {
                const numbers = existingQuestionnaires
                    .map((q) => {
                        const match = q.questionnaireId.match(/QUEST-(\d+)/);
                        return match ? parseInt(match[1], 10) : 0;
                    })
                    .filter((n) => n > 0);
                if (numbers.length > 0) {
                    nextNumber = Math.max(...numbers) + 1;
                }
            }
            const questionnaireId = `QUEST-${String(nextNumber).padStart(4, '0')}`;

            const questionnaire = await prisma.questionnaire.create({
                data: {
                    questionnaireId,
                    title: body.title.trim(),
                    description: body.description?.trim() || null,
                    auditType: body.auditType || 'PRE_AUDIT',
                    isPublished: true,
                    isActive: true,
                    questions: {
                        create: body.questions.map((q: QuestionInput, index: number) => ({
                            priorityOrder: index + 1,
                            question: q.question.trim(),
                            questionType: q.questionType,
                            weightage: q.questionType === 'TEXT' ? parseFloat(q.weightage || '0') : null,
                            imageCount: q.questionType === 'IMAGE' ? (q.imageCount || 1) : null,
                            isActive: true,
                            choices: buildChoicesCreate(q),
                        })),
                    },
                },
                include: {
                    questions: {
                        include: { choices: true },
                        orderBy: { priorityOrder: 'asc' },
                    },
                },
            });

            return successResponse(questionnaire, 'Questionnaire created successfully', 201);
        } catch (error) {
            console.error('Error creating questionnaire:', error);
            return errorResponse('Failed to create questionnaire', 500);
        }
    })(request);
}

// PUT /api/questionnaires
export async function PUT(request: NextRequest) {
    return withRole(['ADMIN'], async () => {
        try {
            const body = await request.json();

            if (!body.id) {
                return errorResponse('Questionnaire ID is required', 400);
            }

            if (!body.title?.trim()) {
                return errorResponse('Questionnaire title is required', 400);
            }

            if (!body.questions || body.questions.length === 0) {
                return errorResponse('At least one question is required', 400);
            }

            const existing = await prisma.questionnaire.findUnique({
                where: { id: body.id },
            });

            if (!existing) {
                return errorResponse('Questionnaire not found', 404);
            }

            // Delete all existing questions (cascade deletes choices)
            await prisma.question.deleteMany({
                where: { questionnaireId: body.id },
            });

            const questionnaire = await prisma.questionnaire.update({
                where: { id: body.id },
                data: {
                    title: body.title.trim(),
                    description: body.description?.trim() || null,
                    auditType: body.auditType || existing.auditType,
                    questions: {
                        create: body.questions.map((q: QuestionInput, index: number) => ({
                            priorityOrder: index + 1,
                            question: q.question.trim(),
                            questionType: q.questionType,
                            weightage: q.questionType === 'TEXT' ? parseFloat(q.weightage || '0') : null,
                            imageCount: q.questionType === 'IMAGE' ? (q.imageCount || 1) : null,
                            isActive: true,
                            choices: buildChoicesCreate(q),
                        })),
                    },
                },
                include: {
                    questions: {
                        include: { choices: true },
                        orderBy: { priorityOrder: 'asc' },
                    },
                },
            });

            return successResponse(questionnaire, 'Questionnaire updated successfully');
        } catch (error) {
            console.error('Error updating questionnaire:', error);
            return errorResponse('Failed to update questionnaire', 500);
        }
    })(request);
}

// DELETE /api/questionnaires
export async function DELETE(request: NextRequest) {
    return withRole(['ADMIN'], async () => {
        try {
            const { searchParams } = new URL(request.url);
            const id = searchParams.get('id');

            if (!id) {
                return errorResponse('Questionnaire ID is required', 400);
            }

            const existing = await prisma.questionnaire.findUnique({
                where: { id },
            });

            if (!existing) {
                return errorResponse('Questionnaire not found', 404);
            }

            await prisma.questionnaire.update({
                where: { id },
                data: { isActive: false },
            });

            return successResponse(null, 'Questionnaire deleted successfully');
        } catch (error) {
            console.error('Error deleting questionnaire:', error);
            return errorResponse('Failed to delete questionnaire', 500);
        }
    })(request);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

interface QuestionInput {
    question: string;
    questionType: 'TEXT' | 'YES_OR_NO' | 'MULTIPLE_CHOICE' | 'SINGLE_CHOICE' | 'IMAGE';
    weightage?: string;
    yesWeightage?: string;
    noWeightage?: string;
    imageCount?: number;
    choices?: Array<{ choice: string; weightage: string }>;
}

function buildChoicesCreate(q: QuestionInput) {
    if (q.questionType === 'YES_OR_NO') {
        return {
            create: [
                { choice: 'YES', weightage: parseFloat(q.yesWeightage || '1'), isActive: true },
                { choice: 'NO', weightage: parseFloat(q.noWeightage || '1'), isActive: true },
            ],
        };
    }
    if (q.questionType === 'MULTIPLE_CHOICE' || q.questionType === 'SINGLE_CHOICE') {
        return {
            create: (q.choices || []).map((c) => ({
                choice: c.choice.trim(),
                weightage: parseFloat(c.weightage || '1'),
                isActive: true,
            })),
        };
    }
    return undefined;
}
