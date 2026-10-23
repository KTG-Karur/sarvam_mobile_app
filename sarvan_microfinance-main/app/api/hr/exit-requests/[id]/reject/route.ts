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

// POST /api/hr/exit-requests/[id]/reject
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requirePermission(request, 'hr-exit', 'approve');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { id } = await params;
        const exitRequest = await prisma.employeeExitRequest.findUnique({
            where: { id },
            include: { employee: { select: { branchId: true } } },
        });
        if (!exitRequest) return errorResponse('Exit request not found', 404);
        if (!(await isEmployeeInCallerScope(ctx, exitRequest.employee.branchId))) {
            return errorResponse('You do not have access to this employee', 403);
        }
        if (exitRequest.status === 'REJECTED') {
            return successResponse(exitRequest, 'Exit request already rejected');
        }
        if (exitRequest.status !== 'IN_PROGRESS') {
            return errorResponse(`Cannot reject an exit request in '${exitRequest.status}' status`, 409);
        }

        const body = await request.json();
        const { reviewRemarks } = rejectSchema.parse(body);

        // ENGINE PATH: Row has an approvalInstanceId
        let approvalInstanceId = exitRequest.approvalInstanceId;
        if (!approvalInstanceId) {
            const existingInstance = await prisma.approvalInstance.findFirst({
                where: {
                    recordType: 'EmployeeExitRequest',
                    recordId: id,
                    status: { in: ['PENDING', 'IN_PROGRESS'] },
                },
                select: { id: true },
            });
            if (existingInstance) {
                approvalInstanceId = existingInstance.id;
                await prisma.employeeExitRequest.update({
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

            const updated = await prisma.employeeExitRequest.update({
                where: { id },
                data: {
                    status: 'REJECTED',
                    finalHrApprovedById: ctx.userId,
                    finalHrApprovedAt: new Date(),
                },
                include: {
                    employee: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
                },
            });

            return successResponse(updated, 'Exit request rejected');
        }

        // LEGACY PATH: Legacy row with approvalInstanceId = null
        const isAdmin = ctx.roles.some((r) => r.roleSlug === 'admin');
        if (exitRequest.initiatedById === ctx.userId && !isAdmin) {
            return errorResponse('Self-rejection is not allowed', 400);
        }

        const updated = await prisma.employeeExitRequest.update({
            where: { id },
            data: {
                status: 'REJECTED',
                finalHrApprovedById: ctx.userId,
                finalHrApprovedAt: new Date(),
            },
            include: {
                employee: { select: { id: true, firstName: true, lastName: true, employeeId: true } },
            },
        });

        return successResponse(updated, 'Exit request rejected');
    } catch (error: unknown) {
        if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
        const message = error instanceof Error ? error.message : 'Failed to reject exit request';
        if (message === 'Self-approval is not allowed' || message === 'Self-rejection is not allowed') {
            return errorResponse(message, 400);
        }
        if (message.startsWith('Action requires role') || message.startsWith('You do not have access')) {
            return errorResponse(message, 403);
        }
        if (message.includes('already ') || message.includes('cannot process')) {
            return errorResponse(message, 409);
        }
        console.error('Error rejecting exit request:', error);
        return errorResponse(message, 500);
    }
}

