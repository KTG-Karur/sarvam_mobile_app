import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { requirePermission, isUserContext, isEmployeeInCallerScope } from '@/app/lib/permissions/guards';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const clearSchema = z.object({
    status: z.enum(['CLEARED', 'FLAGGED']),
    remarks: z.string().optional().nullable(),
});

// POST /api/hr/exit-requests/[id]/clearance-items/[itemId]/clear
// Departments like AUDIT/ACCOUNTS/IT don't have dedicated roles in this system
// yet, so this is gated by the general hr-exit:edit permission (broadly held
// by HR/managerial staff) rather than a per-department role mapping.
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string; itemId: string }> }
) {
    const ctx = await requirePermission(request, 'hr-exit', 'edit');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { id, itemId } = await params;

        const item = await prisma.employeeExitClearanceItem.findUnique({ where: { id: itemId } });
        if (!item || item.exitRequestId !== id) return errorResponse('Clearance item not found', 404);

        const exitRequest = await prisma.employeeExitRequest.findUnique({
            where: { id },
            include: { employee: { select: { branchId: true } } },
        });
        if (!exitRequest) return errorResponse('Exit request not found', 404);
        if (!(await isEmployeeInCallerScope(ctx, exitRequest.employee.branchId))) {
            return errorResponse('You do not have access to this employee', 403);
        }
        // Maker-checker: the person leaving can't sign off their own clearance.
        if (exitRequest.employeeId === ctx.userId) {
            return errorResponse('You cannot clear items on your own exit request', 403);
        }
        if (exitRequest.status !== 'IN_PROGRESS') {
            return errorResponse(`Cannot update clearance items on an exit request in '${exitRequest.status}' status`, 409);
        }

        const body = await request.json();
        const data = clearSchema.parse(body);

        const updated = await prisma.employeeExitClearanceItem.update({
            where: { id: itemId },
            data: {
                status: data.status,
                remarks: data.remarks,
                clearedById: ctx.userId,
                clearedAt: new Date(),
            },
        });

        return successResponse(updated, 'Clearance item updated successfully');
    } catch (error: unknown) {
        if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
        console.error('Error updating clearance item:', error);
        const message = error instanceof Error ? error.message : 'Failed to update clearance item';
        return errorResponse(message, 500);
    }
}
