import { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { requirePermission, requireEmployeeAccess, isUserContext } from '@/app/lib/permissions/guards';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const createSchema = z.object({
    employeeId: z.string().min(1),
    reviewPeriodStart: z.coerce.date(),
    reviewPeriodEnd: z.coerce.date(),
    overallRating: z.number().int().min(1).max(5),
    comments: z.string().optional().nullable(),
});

// GET /api/hr/performance/reviews — own reviews by default, or team-wide via
// ?scope=team, or a single employee's via ?employeeId=.
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const scope = searchParams.get('scope');
            const employeeId = searchParams.get('employeeId');

            let where: Prisma.PerformanceReviewWhereInput = { employeeId: user.userId };
            if (employeeId && employeeId !== user.userId) {
                const ctx = await requireEmployeeAccess(req, employeeId);
                if (!isUserContext(ctx)) return ctx;
                where = { employeeId };
            } else if (scope === 'team') {
                const permittedBranchIds = await getPermittedBranchIds(user);
                where = permittedBranchIds ? { employee: { branchId: { in: permittedBranchIds } } } : {};
            }

            const reviews = await prisma.performanceReview.findMany({
                where,
                include: {
                    employee: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
                    reviewer: { select: { id: true, firstName: true, lastName: true } },
                },
                orderBy: { reviewPeriodEnd: 'desc' },
            });

            return successResponse(reviews, 'Performance reviews fetched successfully');
        } catch (error: any) {
            console.error('Error fetching performance reviews:', error);
            return errorResponse(error.message || 'Failed to fetch performance reviews', 500);
        }
    })(request);
}

// POST /api/hr/performance/reviews — reviewer (manager/HR) creates a DRAFT review.
export async function POST(request: NextRequest) {
    const ctx = await requirePermission(request, 'hr-performance', 'create');
    if (!isUserContext(ctx)) return ctx;

    try {
        const body = await request.json();
        const data = createSchema.parse(body);

        if (data.employeeId === ctx.userId) {
            return errorResponse('You cannot review yourself', 400);
        }

        const review = await prisma.performanceReview.create({
            data: {
                employeeId: data.employeeId,
                reviewerId: ctx.userId,
                reviewPeriodStart: data.reviewPeriodStart,
                reviewPeriodEnd: data.reviewPeriodEnd,
                overallRating: data.overallRating,
                comments: data.comments,
            },
            include: {
                employee: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
            },
        });

        return successResponse(review, 'Performance review created successfully', 201);
    } catch (error: any) {
        if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
        console.error('Error creating performance review:', error);
        return errorResponse(error.message || 'Failed to create performance review', 500);
    }
}
