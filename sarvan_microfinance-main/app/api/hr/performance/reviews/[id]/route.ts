import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const editSchema = z.object({
    overallRating: z.number().int().min(1).max(5).optional(),
    comments: z.string().optional().nullable(),
    reviewPeriodStart: z.coerce.date().optional(),
    reviewPeriodEnd: z.coerce.date().optional(),
    action: z.enum(['submit', 'acknowledge']).optional(),
});

// PATCH /api/hr/performance/reviews/[id]
// - The reviewer may edit fields or submit (DRAFT -> SUBMITTED) while it's a draft.
// - The reviewed employee may acknowledge (SUBMITTED -> ACKNOWLEDGED) their own review.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    return withAuth(async (req, user) => {
        try {
            const { id } = await params;
            const review = await prisma.performanceReview.findUnique({ where: { id } });
            if (!review) return errorResponse('Performance review not found', 404);

            const body = await req.json();
            const data = editSchema.parse(body);

            if (data.action === 'acknowledge') {
                if (review.employeeId !== user.userId) {
                    return errorResponse('Only the reviewed employee can acknowledge this review', 403);
                }
                if (review.status !== 'SUBMITTED') {
                    return errorResponse(`Cannot acknowledge a review in '${review.status}' status`, 409);
                }
                const updated = await prisma.performanceReview.update({
                    where: { id },
                    data: { status: 'ACKNOWLEDGED', acknowledgedAt: new Date() },
                });
                return successResponse(updated, 'Review acknowledged');
            }

            if (review.reviewerId !== user.userId) {
                return errorResponse('Only the reviewer can edit or submit this review', 403);
            }
            if (review.status !== 'DRAFT') {
                return errorResponse(`Cannot edit a review in '${review.status}' status`, 409);
            }

            const { action, ...fields } = data;
            const updated = await prisma.performanceReview.update({
                where: { id },
                data: {
                    ...fields,
                    ...(action === 'submit' ? { status: 'SUBMITTED', submittedAt: new Date() } : {}),
                },
            });

            return successResponse(updated, action === 'submit' ? 'Review submitted' : 'Review updated');
        } catch (error: any) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            console.error('Error updating performance review:', error);
            return errorResponse(error.message || 'Failed to update performance review', 500);
        }
    })(request);
}
