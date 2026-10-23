import { NextRequest } from 'next/server';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { z } from 'zod';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/grt-sessions?centerId=
 * Lists GRT sessions for a center (a center can have multiple sessions
 * across different dates).
 */
export async function GET(request: NextRequest) {
    return withRole(['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'], async (req) => {
        try {
            const { searchParams } = new URL(req.url);
            const centerId = searchParams.get('centerId');
            if (!centerId) return errorResponse('centerId is required', 400);

            const sessions = await prisma.grtSession.findMany({
                where: { centerId },
                select: {
                    id: true,
                    sessionId: true,
                    sessionDate: true,
                    completedAt: true,
                    questionnaire: { select: { title: true } },
                    clients: { select: { loanId: true } },
                    createdBy: { select: { firstName: true, lastName: true } },
                },
                orderBy: { sessionDate: 'desc' },
            });

            return successResponse(
                sessions.map((s) => ({
                    id: s.id,
                    sessionId: s.sessionId,
                    sessionDate: s.sessionDate.toISOString().split('T')[0],
                    questionnaireTitle: s.questionnaire.title,
                    memberCount: s.clients.length,
                    isComplete: !!s.completedAt,
                    createdBy: `${s.createdBy.firstName} ${s.createdBy.lastName}`.trim(),
                })),
                'GRT sessions retrieved successfully'
            );
        } catch (error: any) {
            console.error('Error fetching GRT sessions:', error);
            return errorResponse(error.message || 'Failed to fetch GRT sessions', 500);
        }
    })(request);
}

const createSchema = z.object({
    centerId: z.string().min(1),
    sessionDate: z.string().min(1),
    questionnaireId: z.string().min(1),
    loanIds: z.array(z.string().min(1)).min(1, 'Select at least one member'),
});

/**
 * POST /api/grt-sessions
 * Creates a new center-wide GRT session covering the selected members'
 * CURRENT loans — membership is loan-scoped so a renewal/new loan for the
 * same client always needs its own separate GRT coverage.
 */
export async function POST(request: NextRequest) {
    return withRole(['BRANCH_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'], async (req, user) => {
        try {
            const body = await req.json();
            const { centerId, sessionDate, questionnaireId, loanIds } = createSchema.parse(body);

            const center = await prisma.center.findUnique({
                where: { id: centerId },
                select: { id: true, branchId: true, code: true, branch: { select: { code: true } } },
            });
            if (!center) return errorResponse('Center not found', 404);

            const questionnaire = await prisma.questionnaire.findUnique({ where: { id: questionnaireId } });
            if (!questionnaire) return errorResponse('Questionnaire not found', 404);

            const loans = await prisma.loan.findMany({
                where: { id: { in: loanIds }, centerId, isActive: true },
                select: { id: true, clientId: true },
            });
            if (loans.length !== loanIds.length) {
                return errorResponse('One or more selected loans do not belong to this center', 400);
            }

            const existingCount = await prisma.grtSession.count({ where: { centerId } });
            const sessionId = `GRT-${center.branch?.code ?? '000'}-${center.code}-${(existingCount + 1).toString().padStart(4, '0')}`;

            const session = await prisma.grtSession.create({
                data: {
                    sessionId,
                    centerId,
                    branchId: center.branchId,
                    sessionDate: new Date(sessionDate),
                    questionnaireId,
                    createdById: user.userId,
                    clients: { create: loans.map((l) => ({ loanId: l.id, clientId: l.clientId })) },
                },
            });

            return successResponse({ id: session.id, sessionId: session.sessionId }, 'GRT session created', 201);
        } catch (error: any) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            console.error('Error creating GRT session:', error);
            return errorResponse(error.message || 'Failed to create GRT session', 500);
        }
    })(request);
}
