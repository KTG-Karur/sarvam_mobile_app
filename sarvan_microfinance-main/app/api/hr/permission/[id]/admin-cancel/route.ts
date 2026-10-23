import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { requirePermission, isUserContext } from '@/app/lib/permissions/guards';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const bodySchema = z.object({
    reason: z.string().min(1, 'A cancellation reason is required'),
});

// POST /api/hr/permission/[id]/admin-cancel — cancels an already-APPROVED
// permission with a reason. RBAC-gated (hr-leave:override) rather than a
// hardcoded role — no role is granted it by default except ADMIN (who bypasses
// all checks), so this preserves today's admin-only behavior while letting an
// admin extend it to other roles from the Roles editor.
//
// Cancelling a permission no longer needs to touch Attendance — approved
// permission hours never affect punch-derived working hours/status anymore
// (see attendance-hr/plan-permission-hours-payroll.md); their only
// consequence is a total-hours figure Payroll reads when processing that
// month's pay, which naturally excludes a CANCELLED permission's hours the
// next time it's computed.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requirePermission(request, 'hr-leave', 'override');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { id } = await params;
        const body = await request.json();
        const { reason } = bodySchema.parse(body);

        const permissionRequest = await prisma.permissionRequest.findUnique({ where: { id } });
        if (!permissionRequest) return errorResponse('Permission request not found', 404);
        if (permissionRequest.status !== 'APPROVED') {
            return errorResponse(`Only an APPROVED permission can be admin-cancelled (this one is '${permissionRequest.status}')`, 409);
        }

        const updated = await prisma.$transaction(async (tx) => {
            const fresh = await tx.permissionRequest.findUnique({ where: { id } });
            if (!fresh || fresh.status !== 'APPROVED') {
                throw new Error('Permission request status changed — please refresh and retry');
            }

            return tx.permissionRequest.update({
                where: { id },
                data: {
                    status: 'CANCELLED',
                    cancelledById: ctx.userId,
                    cancelledAt: new Date(),
                    cancelReason: reason,
                },
            });
        });

        return successResponse(updated, 'Approved permission cancelled.');
    } catch (error: unknown) {
        if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
        console.error('Error admin-cancelling permission request:', error);
        const message = error instanceof Error ? error.message : 'Failed to cancel approved permission';
        return errorResponse(message, 500);
    }
}
