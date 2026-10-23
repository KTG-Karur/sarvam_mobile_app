import { NextRequest } from 'next/server';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { z } from 'zod';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const schema = z.object({ loanIds: z.array(z.string().min(1)).min(1, 'Select at least one member') });

/**
 * PATCH /api/grt-sessions/[sessionId]/clients
 * Replaces the selected member (loan) set for a not-yet-completed session.
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> }
) {
    return withRole(['BRANCH_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'], async (req) => {
        try {
            const { sessionId } = await params;
            const body = await req.json();
            const { loanIds } = schema.parse(body);

            const session = await prisma.grtSession.findFirst({
                where: { OR: [{ id: sessionId }, { sessionId: sessionId }] },
                select: { id: true, centerId: true, completedAt: true },
            });
            if (!session) return errorResponse('GRT session not found', 404);
            if (session.completedAt) return errorResponse('Cannot change members of a completed GRT session', 400);

            const loans = await prisma.loan.findMany({ where: { id: { in: loanIds }, centerId: session.centerId, isActive: true }, select: { id: true, clientId: true } });
            if (loans.length !== loanIds.length) {
                return errorResponse('One or more selected loans do not belong to this center', 400);
            }

            await prisma.$transaction([
                prisma.grtSessionClient.deleteMany({ where: { grtSessionId: session.id } }),
                prisma.grtSessionClient.createMany({
                    data: loans.map((l) => ({ grtSessionId: session.id, loanId: l.id, clientId: l.clientId })),
                }),
            ]);

            return successResponse({ count: loanIds.length }, 'Members updated');
        } catch (error: any) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            console.error('Error updating GRT session members:', error);
            return errorResponse(error.message || 'Failed to update members', 500);
        }
    })(request);
}
