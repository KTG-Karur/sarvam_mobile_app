import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse } from '@/app/lib/api-utils';
import { requirePermission, isUserContext, isEmployeeInCallerScope } from '@/app/lib/permissions/guards';
import { describePendingApprovals } from '@/app/lib/approval/record-approval';
import { getOutstandingBelongings, getClosedBelongings } from '@/app/lib/hr/exit-belongings-check';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// GET /api/hr/exit-requests/[id] — 'view' permission + branch scope, not
// just any authenticated user: a bare withAuth here let anyone signed in
// fetch any exit request by ID (reason, clearance detail), with no branch
// check at all.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requirePermission(request, 'hr-exit', 'view');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { id } = await params;
        const exitRequest = await prisma.employeeExitRequest.findUnique({
            where: { id },
            include: {
                employee: {
                    select: {
                        id: true, firstName: true, lastName: true, employeeId: true, dateOfJoining: true, branchId: true,
                        designation: { select: { name: true } },
                        department: { select: { name: true } },
                        branch: { select: { name: true } },
                    },
                },
                initiatedBy: { select: { id: true, firstName: true, lastName: true } },
                finalHrApprovedBy: { select: { id: true, firstName: true, lastName: true } },
                clearanceItems: {
                    include: { clearedBy: { select: { id: true, firstName: true, lastName: true } } },
                    orderBy: [{ department: 'asc' }],
                },
            },
        });
        if (!exitRequest) return errorResponse('Exit request not found', 404);
        if (!(await isEmployeeInCallerScope(ctx, exitRequest.employee.branchId))) {
            return errorResponse('You do not have access to this employee', 403);
        }

        const approvals = exitRequest.status === 'IN_PROGRESS'
            ? await describePendingApprovals(
                'hr-exit',
                'EmployeeExitRequest',
                [{ id: exitRequest.id, branchId: exitRequest.employee.branchId }],
                ctx
            )
            : new Map();

        // Only relevant while it can still be finalized — a COMPLETED/REJECTED
        // exit's belongings status is whatever it is now, not part of this record.
        const outstandingBelongings = exitRequest.status === 'IN_PROGRESS'
            ? await getOutstandingBelongings(exitRequest.employeeId)
            : [];
        // Handed-back items with their return proof (photos / signature / declaration).
        const returnedBelongings = await getClosedBelongings(exitRequest.employeeId);

        return successResponse(
            { ...exitRequest, approval: approvals.get(exitRequest.id) ?? null, outstandingBelongings, returnedBelongings },
            'Exit request fetched successfully'
        );
    } catch (error: unknown) {
        console.error('Error fetching exit request:', error);
        const message = error instanceof Error ? error.message : 'Failed to fetch exit request';
        return errorResponse(message, 500);
    }
}
