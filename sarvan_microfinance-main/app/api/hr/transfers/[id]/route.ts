import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse } from '@/app/lib/api-utils';
import { requirePermission, isUserContext, isEmployeeInCallerScope } from '@/app/lib/permissions/guards';
import { getWorkflowStatus } from '@/app/lib/approval/engine';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// GET /api/hr/transfers/[id] — transfer record + its approval-engine stage
// timeline. 'view' permission + branch scope, not just any authenticated
// user: a bare withAuth here let anyone signed in fetch any transfer by ID,
// with no branch check at all.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requirePermission(request, 'hr-transfer', 'view');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { id } = await params;
        const transfer = await prisma.employeeTransfer.findUnique({
            where: { id },
            include: {
                employee: { select: { id: true, firstName: true, lastName: true, employeeId: true, branchId: true } },
                fromBranch: { select: { name: true } },
                toBranch: { select: { name: true } },
                fromArea: { select: { name: true } },
                toArea: { select: { name: true } },
                fromRegion: { select: { name: true } },
                toRegion: { select: { name: true } },
                fromDepartment: { select: { name: true } },
                toDepartment: { select: { name: true } },
                requestedBy: { select: { id: true, firstName: true, lastName: true } },
                replacementEmployee: { select: { id: true, firstName: true, lastName: true } },
            },
        });
        if (!transfer) return errorResponse('Transfer not found', 404);
        if (!(await isEmployeeInCallerScope(ctx, transfer.employee.branchId))) {
            return errorResponse('You do not have access to this employee', 403);
        }

        const workflow = transfer.approvalInstanceId
            ? await getWorkflowStatus(transfer.approvalInstanceId).catch(() => null)
            : null;

        return successResponse({ transfer, workflow }, 'Transfer fetched successfully');
    } catch (error: any) {
        console.error('Error fetching transfer:', error);
        return errorResponse(error.message || 'Failed to fetch transfer', 500);
    }
}
