import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { requireAuth, requireEmployeeAccess, isUserContext } from '@/app/lib/permissions/guards';
import { checkPermission } from '@/app/lib/permissions/engine';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const createSchema = z.object({
    employeeId: z.string().min(1).optional(),
    title: z.string().min(1),
    description: z.string().optional().nullable(),
    targetDate: z.coerce.date(),
    targetMetric: z.string().optional().nullable(),
});

// GET /api/hr/performance/goals — own goals by default, or a team-wide view
// (branch-scoped) via ?scope=team, or a single employee's via ?employeeId=.
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const scope = searchParams.get('scope');
            const employeeId = searchParams.get('employeeId');

            let where: Prisma.PerformanceGoalWhereInput = { employeeId: user.userId };
            if (employeeId && employeeId !== user.userId) {
                const ctx = await requireEmployeeAccess(req, employeeId);
                if (!isUserContext(ctx)) return ctx;
                where = { employeeId };
            } else if (scope === 'team') {
                const permittedBranchIds = await getPermittedBranchIds(user);
                where = permittedBranchIds ? { employee: { branchId: { in: permittedBranchIds } } } : {};
            }

            const goals = await prisma.performanceGoal.findMany({
                where,
                include: {
                    employee: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
                    createdBy: { select: { id: true, firstName: true, lastName: true } },
                },
                orderBy: { targetDate: 'asc' },
            });

            return successResponse(goals, 'Performance goals fetched successfully');
        } catch (error: any) {
            console.error('Error fetching performance goals:', error);
            return errorResponse(error.message || 'Failed to fetch performance goals', 500);
        }
    })(request);
}

// POST /api/hr/performance/goals — self-set (employeeId defaults to caller,
// always allowed) or HR/managerial staff assigning a goal to another employee
// (requires the hr-performance:create permission dynamically).
export async function POST(request: NextRequest) {
    const ctx = await requireAuth(request);
    if (!isUserContext(ctx)) return ctx;

    try {
        const body = await request.json();
        const data = createSchema.parse(body);

        const targetEmployeeId = data.employeeId ?? ctx.userId;
        if (targetEmployeeId !== ctx.userId) {
            const perm = checkPermission(ctx, { moduleSlug: 'hr-performance', actionSlug: 'create' });
            if (!perm.allowed) return errorResponse('You can only set goals for yourself', 403);
        }

        const goal = await prisma.performanceGoal.create({
            data: {
                employeeId: targetEmployeeId,
                title: data.title,
                description: data.description,
                targetDate: data.targetDate,
                targetMetric: data.targetMetric,
                createdById: ctx.userId,
            },
            include: {
                employee: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
            },
        });

        return successResponse(goal, 'Performance goal created successfully', 201);
    } catch (error: any) {
        if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
        console.error('Error creating performance goal:', error);
        return errorResponse(error.message || 'Failed to create performance goal', 500);
    }
}
