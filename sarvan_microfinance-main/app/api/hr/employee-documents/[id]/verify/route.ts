import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { requirePermission, isUserContext, isEmployeeInCallerScope } from '@/app/lib/permissions/guards';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// POST /api/hr/employee-documents/[id]/verify
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
        if (document.status === 'VERIFIED') {
            return successResponse(document, 'Document already verified');
        }
        if (document.uploadedById === ctx.userId) {
            return errorResponse('Self-verification is not allowed', 400);
        }

        const updated = await prisma.employeeDocument.update({
            where: { id },
            data: {
                status: 'VERIFIED',
                verifiedById: ctx.userId,
                verifiedAt: new Date(),
                rejectionReason: null,
            },
        });

        return successResponse(updated, 'Document verified successfully');
    } catch (error: any) {
        console.error('Error verifying employee document:', error);
        return errorResponse(error.message || 'Failed to verify document', 500);
    }
}
