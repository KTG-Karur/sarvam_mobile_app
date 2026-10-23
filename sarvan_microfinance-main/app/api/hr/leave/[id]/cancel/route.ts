import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { canActorApplyForEmployee, isUserContext } from '@/app/lib/permissions/guards';
import { cancelRecordApproval } from '@/app/lib/approval/record-approval';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// POST /api/hr/leave/[id]/cancel — cancel of PENDING application by employee or authorized manager.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    return withAuth(async (req, user) => {
        try {
            const { id } = await params;
            const application = await prisma.leaveApplication.findUnique({ where: { id } });
            if (!application) return errorResponse('Leave application not found', 404);
            if (application.employeeId !== user.userId) {
                const authRes = await canActorApplyForEmployee(req, application.employeeId, '/dashboard/hr/leave/apply');
                if (!isUserContext(authRes)) return authRes;
            }
            if (application.status !== 'PENDING') {
                return errorResponse(`Cannot cancel an application in '${application.status}' status`, 409);
            }

            const updated = await prisma.leaveApplication.update({
                where: { id },
                data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: user.userId },
            });
            await cancelRecordApproval('LeaveApplication', id, user.userId);

            return successResponse(updated, 'Leave application cancelled');
        } catch (error: unknown) {
            console.error('Error cancelling leave application:', error);
            const message = error instanceof Error ? error.message : 'Failed to cancel leave application';
            return errorResponse(message, 500);
        }
    })(request);
}
