import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { requirePermission, isUserContext, isEmployeeInCallerScope } from '@/app/lib/permissions/guards';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const rejectSchema = z.object({
    rejectionReason: z.string().min(1, 'Rejection reason is required'),
});

// POST /api/hr/employee-documents/[id]/reject
// Reject is the negative outcome of the same verification action, so it's
// gated by the same 'verify' permission rather than a separate one.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const ctx = await requirePermission(request, 'hr-employee', 'verify');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { id } = await params;
        const document = await prisma.employeeDocument.findUnique({
            where: { id },
            include: { employee: { select: { branchId: true } } },
        });
        if (!document) return errorResponse('Document not found', 404);
        if (!(await isEmployeeInCallerScope(ctx, document.employee.branchId))) {
            return errorResponse('You do not have access to this employee', 403);
        }
        if (document.status === 'REJECTED') {
            return successResponse(document, 'Document already rejected');
        }
        if (document.uploadedById === ctx.userId) {
            return errorResponse('Self-rejection is not allowed', 400);
        }

        const body = await request.json();
        const { rejectionReason } = rejectSchema.parse(body);

        const updated = await prisma.employeeDocument.update({
            where: { id },
            data: {
                status: 'REJECTED',
                verifiedById: ctx.userId,
                verifiedAt: new Date(),
                rejectionReason,
            },
        });

        return successResponse(updated, 'Document rejected');
    } catch (error: any) {
        if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
        console.error('Error rejecting employee document:', error);
        return errorResponse(error.message || 'Failed to reject document', 500);
    }
}
