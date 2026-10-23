import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { requirePermission, requireEmployeeAccess, isUserContext, isEmployeeInCallerScope } from '@/app/lib/permissions/guards';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const issueSchema = z.object({
    employeeId: z.string().min(1),
    belongingItemId: z.string().min(1),
    remarks: z.string().optional().nullable(),
});

// GET /api/hr/belongings/issued?employeeId=
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const employeeId = searchParams.get('employeeId') || user.userId;

            if (employeeId !== user.userId) {
                const ctx = await requireEmployeeAccess(req, employeeId);
                if (!isUserContext(ctx)) return ctx;
            }

            const records = await prisma.employeeIssuedBelonging.findMany({
                where: { employeeId },
                include: {
                    belongingItem: true,
                    issuedBy: { select: { id: true, firstName: true, lastName: true } },
                    returnedTo: { select: { id: true, firstName: true, lastName: true } },
                    returnProofs: {
                        select: { id: true, fileKey: true, fileName: true, mimeType: true },
                        orderBy: { createdAt: 'asc' },
                    },
                },
                orderBy: { issuedDate: 'desc' },
            });

            return successResponse(records, 'Issued belongings fetched successfully');
        } catch (error: any) {
            console.error('Error fetching issued belongings:', error);
            return errorResponse(error.message || 'Failed to fetch issued belongings', 500);
        }
    })(request);
}

// POST /api/hr/belongings/issued — issue an item to an employee
export async function POST(request: NextRequest) {
    const ctx = await requirePermission(request, 'hr-employee', 'edit');
    if (!isUserContext(ctx)) return ctx;

    try {
        const body = await request.json();
        const data = issueSchema.parse(body);

        const employee = await prisma.user.findUnique({
            where: { id: data.employeeId },
            select: { branchId: true, isActive: true },
        });
        if (!employee) return errorResponse('Employee not found', 404);
        // hr-employee:edit alone says nothing about WHICH branch's employees the
        // caller may act on — same branch scope every other HR write route applies.
        if (!(await isEmployeeInCallerScope(ctx, employee.branchId))) {
            return errorResponse('You do not have access to this employee', 403);
        }
        if (employee.isActive === false) {
            return errorResponse('This employee is no longer active — cannot issue items to them', 409);
        }

        const item = await prisma.employeeBelongingItem.findUnique({
            where: { id: data.belongingItemId },
            select: { isActive: true },
        });
        if (!item) return errorResponse('Belonging item not found', 404);
        if (!item.isActive) return errorResponse('This item is no longer in the active catalog', 409);

        // A double-click (or a second HR user) would otherwise create two open
        // records for the same item, and the employee couldn't clear exit until
        // both were returned.
        const alreadyIssued = await prisma.employeeIssuedBelonging.findFirst({
            where: { employeeId: data.employeeId, belongingItemId: data.belongingItemId, status: 'ISSUED' },
            select: { id: true },
        });
        if (alreadyIssued) return errorResponse('This item is already issued to this employee and not yet returned', 409);

        const record = await prisma.employeeIssuedBelonging.create({
            data: {
                employeeId: data.employeeId,
                belongingItemId: data.belongingItemId,
                remarks: data.remarks,
                issuedById: ctx.userId,
            },
            include: { belongingItem: true },
        });

        return successResponse(record, 'Item issued successfully', 201);
    } catch (error: any) {
        if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
        console.error('Error issuing belonging:', error);
        return errorResponse(error.message || 'Failed to issue item', 500);
    }
}
