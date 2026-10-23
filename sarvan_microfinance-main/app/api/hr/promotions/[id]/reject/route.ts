import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { requirePermission, isUserContext, isEmployeeInCallerScope } from '@/app/lib/permissions/guards';
import { processStageAction } from '@/app/lib/approval/engine';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const rejectSchema = z.object({
    reviewRemarks: z.string().min(1, 'Remarks are required'),
});

// POST /api/hr/promotions/[id]/reject
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requirePermission(request, 'hr-promotion', 'reject');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { id } = await params;
        const promotion = await prisma.employeePromotion.findUnique({
            where: { id },
            include: { employee: { select: { branchId: true } } },
        });
        if (!promotion) return errorResponse('Promotion request not found', 404);
        if (!(await isEmployeeInCallerScope(ctx, promotion.employee.branchId))) {
            return errorResponse('You do not have access to this employee', 403);
        }
        if (promotion.status === 'REJECTED') {
            return successResponse(promotion, 'Promotion already rejected');
        }
        if (promotion.status !== 'PENDING') {
            return errorResponse(`Cannot reject a request in '${promotion.status}' status`, 409);
        }

        const body = await request.json();
        const { reviewRemarks } = rejectSchema.parse(body);

        // ENGINE PATH: Row has an approvalInstanceId
        let approvalInstanceId = promotion.approvalInstanceId;
        if (!approvalInstanceId) {
            const existingInstance = await prisma.approvalInstance.findFirst({
                where: {
                    recordType: 'EmployeePromotion',
                    recordId: id,
                    status: { in: ['PENDING', 'IN_PROGRESS'] },
                },
                select: { id: true },
            });
            if (existingInstance) {
                approvalInstanceId = existingInstance.id;
                await prisma.employeePromotion.update({
                    where: { id },
                    data: { approvalInstanceId: existingInstance.id },
                });
            }
        }

        if (approvalInstanceId) {
            await processStageAction(
                {
                    instanceId: approvalInstanceId,
                    actorUserId: ctx.userId,
                    action: 'reject',
                    remarks: reviewRemarks,
                },
                ctx
            );

            const updated = await prisma.employeePromotion.update({
                where: { id },
                data: {
                    status: 'REJECTED',
                    reviewedById: ctx.userId,
                    reviewedAt: new Date(),
                    reviewRemarks,
                },
                include: {
                    employee: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
                    toDesignation: { select: { id: true, name: true } },
                },
            });

            return successResponse(updated, 'Promotion rejected');
        }

        // LEGACY PATH: Legacy row with approvalInstanceId = null
        const isAdmin = ctx.roles.some((r) => r.roleSlug === 'admin');
        if (promotion.initiatedById === ctx.userId && !isAdmin) {
            return errorResponse('Self-rejection is not allowed', 400);
        }

        const updated = await prisma.employeePromotion.update({
            where: { id },
            data: {
                status: 'REJECTED',
                reviewedById: ctx.userId,
                reviewedAt: new Date(),
                reviewRemarks,
            },
            include: {
                employee: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
                toDesignation: { select: { id: true, name: true } },
            },
        });

        return successResponse(updated, 'Promotion rejected');
    } catch (error: unknown) {
        if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
        const message = error instanceof Error ? error.message : 'Failed to reject promotion';
        if (message === 'Self-approval is not allowed' || message === 'Self-rejection is not allowed') {
            return errorResponse(message, 400);
        }
        if (message.startsWith('Action requires role') || message.startsWith('You do not have access')) {
            return errorResponse(message, 403);
        }
        if (message.includes('already ') || message.includes('cannot process')) {
            return errorResponse(message, 409);
        }
        console.error('Error rejecting promotion:', error);
        return errorResponse(message, 500);
    }
}
