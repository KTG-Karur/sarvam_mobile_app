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
    approvalRemarks: z.string().min(1, 'Remarks are required'),
});

// POST /api/hr/leave/[id]/reject
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requirePermission(request, 'hr-leave', 'reject');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { id } = await params;
        const application = await prisma.leaveApplication.findUnique({
            where: { id },
            include: { employee: { select: { branchId: true } } },
        });
        if (!application) return errorResponse('Leave application not found', 404);
        if (!(await isEmployeeInCallerScope(ctx, application.employee.branchId))) {
            return errorResponse('You do not have access to this employee', 403);
        }
        if (application.status === 'REJECTED') {
            return successResponse(application, 'Leave application already rejected');
        }
        if (application.status !== 'PENDING') {
            return errorResponse(`Cannot reject an application in '${application.status}' status`, 409);
        }

        const body = await request.json();
        const { approvalRemarks } = rejectSchema.parse(body);

        // ENGINE PATH: Row has an approvalInstanceId
        let approvalInstanceId = application.approvalInstanceId;
        if (!approvalInstanceId) {
            const existingInstance = await prisma.approvalInstance.findFirst({
                where: {
                    recordType: 'LeaveApplication',
                    recordId: id,
                    status: { in: ['PENDING', 'IN_PROGRESS'] },
                },
                select: { id: true },
            });
            if (existingInstance) {
                approvalInstanceId = existingInstance.id;
                await prisma.leaveApplication.update({
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
                    remarks: approvalRemarks,
                },
                ctx
            );

            const updated = await prisma.leaveApplication.update({
                where: { id },
                data: { status: 'REJECTED', approvedById: ctx.userId, approvedAt: new Date(), approvalRemarks },
            });

            return successResponse(updated, 'Leave application rejected');
        }

        // LEGACY PATH: Legacy row with approvalInstanceId = null
        const isAdmin = ctx.roles.some((r) => r.roleSlug === 'admin');
        if (application.employeeId === ctx.userId && !isAdmin) {
            return errorResponse('Self-rejection is not allowed', 400);
        }

        const updated = await prisma.leaveApplication.update({
            where: { id },
            data: { status: 'REJECTED', approvedById: ctx.userId, approvedAt: new Date(), approvalRemarks },
        });

        return successResponse(updated, 'Leave application rejected');
    } catch (error: unknown) {
        if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
        const message = error instanceof Error ? error.message : 'Failed to reject leave application';
        if (message === 'Self-approval is not allowed' || message === 'Self-rejection is not allowed') {
            return errorResponse(message, 400);
        }
        if (message.startsWith('Action requires role') || message.startsWith('You do not have access')) {
            return errorResponse(message, 403);
        }
        if (message.includes('already ') || message.includes('cannot process')) {
            return errorResponse(message, 409);
        }
        console.error('Error rejecting leave application:', error);
        return errorResponse(message, 500);
    }
}
