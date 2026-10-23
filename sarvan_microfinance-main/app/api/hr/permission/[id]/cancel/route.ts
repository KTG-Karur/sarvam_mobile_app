import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { canActorApplyForEmployee, isUserContext } from '@/app/lib/permissions/guards';
import { cancelRecordApproval } from '@/app/lib/approval/record-approval';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// POST /api/hr/permission/[id]/cancel — cancel of PENDING request by employee or authorized manager.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    return withAuth(async (req, user) => {
        try {
            const { id } = await params;
            const permissionRequest = await prisma.permissionRequest.findUnique({ where: { id } });
            if (!permissionRequest) return errorResponse('Permission request not found', 404);
            if (permissionRequest.employeeId !== user.userId) {
                const authRes = await canActorApplyForEmployee(req, permissionRequest.employeeId, '/dashboard/hr/permission/apply');
                if (!isUserContext(authRes)) return authRes;
            }
            if (permissionRequest.status !== 'PENDING') {
                return errorResponse(`Cannot cancel a request in '${permissionRequest.status}' status`, 409);
            }

            const updated = await prisma.permissionRequest.update({
                where: { id },
                data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: user.userId },
            });
            await cancelRecordApproval('PermissionRequest', id, user.userId);

            return successResponse(updated, 'Permission request cancelled');
        } catch (error: unknown) {
            console.error('Error cancelling permission request:', error);
            const message = error instanceof Error ? error.message : 'Failed to cancel permission request';
            return errorResponse(message, 500);
        }
    })(request);
}
