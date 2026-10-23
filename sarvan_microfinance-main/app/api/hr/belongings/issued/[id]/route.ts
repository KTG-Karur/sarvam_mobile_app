import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { requirePermission, isUserContext, isEmployeeInCallerScope } from '@/app/lib/permissions/guards';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// GET /api/hr/belongings/issued/[id] — one issued belonging with the details
// the Return Belonging page shows at the top (item, employee, issue info).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requirePermission(request, 'hr-employee', 'view');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { id } = await params;
        const record = await prisma.employeeIssuedBelonging.findUnique({
            where: { id },
            select: {
                id: true,
                status: true,
                issuedDate: true,
                returnedDate: true,
                remarks: true,
                belongingItem: { select: { itemName: true, description: true } },
                issuedBy: { select: { firstName: true, lastName: true } },
                employee: {
                    select: {
                        id: true, firstName: true, lastName: true, employeeId: true, branchId: true,
                        branch: { select: { name: true } },
                        designation: { select: { name: true } },
                    },
                },
            },
        });
        if (!record) return errorResponse('Issued belonging record not found', 404);
        if (!(await isEmployeeInCallerScope(ctx, record.employee.branchId))) {
            return errorResponse('You do not have access to this employee', 403);
        }

        // branchId was only needed for the access check above.
        const { id: employeeUserId, firstName, lastName, employeeId, branch, designation } = record.employee;
        return successResponse(
            { ...record, employee: { id: employeeUserId, firstName, lastName, employeeId, branch, designation } },
            'Issued belonging fetched successfully'
        );
    } catch (error: unknown) {
        console.error('Error fetching issued belonging:', error);
        return errorResponse(error instanceof Error ? error.message : 'Failed to fetch issued belonging', 500);
    }
}
