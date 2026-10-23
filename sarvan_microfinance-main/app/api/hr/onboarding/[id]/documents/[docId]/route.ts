import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse } from '@/app/lib/api-utils';
import { requirePermission, isUserContext } from '@/app/lib/permissions/guards';
import { deleteOnboardingDocument } from '@/app/lib/storage/onboarding-document-storage';

export async function OPTIONS() {
    return handleCorsPreflight();
}

function isBranchScopePermitted(ctx: { isHeadOffice: boolean; branchAccess: { branchId: string }[] }, branchId: string | null): boolean {
    if (ctx.isHeadOffice) return true;
    if (!branchId) return true;
    return ctx.branchAccess.some((ba) => ba.branchId === branchId);
}

// DELETE /api/hr/onboarding/[id]/documents/[docId]
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string; docId: string }> }) {
    const ctx = await requirePermission(request, 'hr-onboarding', 'edit');
    if (!isUserContext(ctx)) return ctx;

    try {
        const { id, docId } = await params;
        const onboardingRequest = await prisma.employeeOnboardingRequest.findUnique({ where: { id }, select: { branchId: true, status: true } });
        if (!onboardingRequest) return errorResponse('Onboarding request not found', 404);
        if (!isBranchScopePermitted(ctx, onboardingRequest.branchId)) {
            return errorResponse('You do not have access to this request', 403);
        }
        if (onboardingRequest.status === 'APPROVED') {
            return errorResponse('This request has already been provisioned — documents can no longer be changed', 409);
        }

        const document = await prisma.onboardingDocument.findUnique({ where: { id: docId } });
        if (!document || document.onboardingRequestId !== id) {
            return errorResponse('Document not found', 404);
        }

        await deleteOnboardingDocument(document.fileUrl);
        await prisma.onboardingDocument.delete({ where: { id: docId } });

        return successResponse(null, 'Document deleted successfully');
    } catch (error: any) {
        console.error('Error deleting onboarding document:', error);
        return errorResponse(error.message || 'Failed to delete document', 500);
    }
}
