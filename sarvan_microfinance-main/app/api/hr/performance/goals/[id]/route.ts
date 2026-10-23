import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { requireAuth, isUserContext } from '@/app/lib/permissions/guards';
import { checkPermission } from '@/app/lib/permissions/engine';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const updateSchema = z.object({
    title: z.string().min(1).optional(),
    description: z.string().optional().nullable(),
    targetDate: z.coerce.date().optional(),
    targetMetric: z.string().optional().nullable(),
    status: z.enum(['OPEN', 'ACHIEVED', 'MISSED', 'CANCELLED']).optional(),
});

// PATCH /api/hr/performance/goals/[id] — the goal's own employee may always
// edit it; anyone else needs the hr-performance:edit permission dynamically.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requireAuth(request);
    if (!isUserContext(ctx)) return ctx;

    try {
        const { id } = await params;
        const goal = await prisma.performanceGoal.findUnique({ where: { id } });
        if (!goal) return errorResponse('Performance goal not found', 404);

        if (goal.employeeId !== ctx.userId) {
            const perm = checkPermission(ctx, { moduleSlug: 'hr-performance', actionSlug: 'edit' });
            if (!perm.allowed) return errorResponse('You do not have access to this goal', 403);
        }

        const body = await request.json();
        const data = updateSchema.parse(body);

        const updated = await prisma.performanceGoal.update({ where: { id }, data });
        return successResponse(updated, 'Performance goal updated successfully');
    } catch (error: any) {
        if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
        console.error('Error updating performance goal:', error);
        return errorResponse(error.message || 'Failed to update performance goal', 500);
    }
}
