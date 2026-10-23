import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { requirePermission, isUserContext, isEmployeeInCallerScope } from '@/app/lib/permissions/guards';
import { processStageAction } from '@/app/lib/approval/engine';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// POST /api/hr/permission/[id]/approve — approves a short-permission request.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requirePermission(request, 'hr-leave', 'approve');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { id } = await params;
        const req = await prisma.permissionRequest.findUnique({
            where: { id },
            include: { employee: { select: { id: true, branchId: true } } },
        });
        if (!req) return errorResponse('Permission request not found', 404);
        if (!(await isEmployeeInCallerScope(ctx, req.employee.branchId))) {
            return errorResponse('You do not have access to this employee', 403);
        }
        if (req.status === 'APPROVED') {
            return successResponse(req, 'Permission request already approved');
        }
        if (req.status !== 'PENDING') {
            return errorResponse(`Cannot approve a request in '${req.status}' status`, 409);
        }

        const executePermissionApproval = async () => {
            return prisma.$transaction(async (tx) => {
                const fresh = await tx.permissionRequest.findUnique({ where: { id } });
                if (!fresh || fresh.status !== 'PENDING') {
                    throw new Error('Permission request status changed — please refresh and retry');
                }
                return tx.permissionRequest.update({
                    where: { id },
                    data: { status: 'APPROVED', approvedById: ctx.userId, approvedAt: new Date() },
                });
            });
        };

        // ENGINE PATH: Row has an approvalInstanceId
        let approvalInstanceId = req.approvalInstanceId;
        if (!approvalInstanceId) {
            const existingInstance = await prisma.approvalInstance.findFirst({
                where: {
                    recordType: 'PermissionRequest',
                    recordId: id,
                    status: { in: ['PENDING', 'IN_PROGRESS'] },
                },
                select: { id: true },
            });
            if (existingInstance) {
                approvalInstanceId = existingInstance.id;
                await prisma.permissionRequest.update({
                    where: { id },
                    data: { approvalInstanceId: existingInstance.id },
                });
            }
        }

        if (approvalInstanceId) {
            const outcome = await processStageAction(
                {
                    instanceId: approvalInstanceId,
                    actorUserId: ctx.userId,
                    action: 'approve',
                },
                ctx
            );

            if (outcome.newStatus === 'APPROVED') {
                const updated = await executePermissionApproval();
                return successResponse(updated, 'Permission request approved successfully');
            }

            // Intermediate stage approved: remain PENDING awaiting next stage
            return successResponse(
                req,
                `Approved at this level — now awaiting ${outcome.nextStage ?? 'the next approval level'}`
            );
        }

        // LEGACY PATH: Legacy row with approvalInstanceId = null
        const isAdmin = ctx.roles.some((r) => r.roleSlug === 'admin');
        if (req.employeeId === ctx.userId && !isAdmin) {
            return errorResponse('Self-approval is not allowed', 400);
        }

        const updated = await executePermissionApproval();
        return successResponse(updated, 'Permission request approved successfully');
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to approve permission request';
        if (message === 'Self-approval is not allowed') {
            return errorResponse('Self-approval is not allowed', 400);
        }
        if (message.startsWith('Action requires role') || message.startsWith('You do not have access')) {
            return errorResponse(message, 403);
        }
        if (message.includes('already ') || message.includes('cannot process')) {
            return errorResponse(message, 409);
        }
        console.error('Error approving permission request:', error);
        return errorResponse(message, 500);
    }
}
