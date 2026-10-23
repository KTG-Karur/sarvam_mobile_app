import { NextRequest } from 'next/server';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { deleteMemberIndividualPhoto } from '@/app/lib/storage/member-individual-storage';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * DELETE /api/member-individual/[loanId]/household-visit/photos/[photoId]
 */
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ loanId: string; photoId: string }> }
) {
    return withRole(['BRANCH_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'], async (req) => {
        try {
            const { photoId } = await params;

            const photo = await prisma.memberIndividualPhoto.findUnique({ where: { id: photoId } });
            if (!photo) return errorResponse('Photo not found', 404);

            await prisma.memberIndividualPhoto.delete({ where: { id: photoId } });
            if (photo.photoKey) await deleteMemberIndividualPhoto(photo.photoKey);

            return successResponse({ id: photoId }, 'Photo deleted');
        } catch (error: any) {
            console.error('Error deleting household visit photo:', error);
            return errorResponse(error.message || 'Failed to delete photo', 500);
        }
    })(request);
}
