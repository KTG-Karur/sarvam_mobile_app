import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { getUserContext } from '@/app/lib/permissions/guards';
import { checkPermission } from '@/app/lib/permissions/engine';
import { getSignedReadUrl } from '@/app/lib/storage/gcs-client';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// GET /api/hr/leave/[id]/attachments/[attachmentId] — a short-lived signed URL for one proof file.
// Allowed: the applicant, or someone who can approve leave (hr-leave:approve) for that employee's
// branch. Deliberately narrower than the "team" leave list, because proof is sensitive (medical).
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string; attachmentId: string }> }) {
    return withAuth(async (req, user) => {
        try {
            const { id, attachmentId } = await params;
            const attachment = await prisma.leaveApplicationAttachment.findFirst({
                where: { id: attachmentId, leaveApplicationId: id },
                select: {
                    fileKey: true, fileName: true, mimeType: true, fileSize: true,
                    leaveApplication: { select: { employeeId: true, employee: { select: { branchId: true } } } },
                },
            });
            if (!attachment) return errorResponse('Attachment not found', 404);

            const ownerId = attachment.leaveApplication.employeeId;
            if (ownerId !== user.userId) {
                const ctx = await getUserContext(req);
                const canApprove = !!ctx && checkPermission(ctx, { moduleSlug: 'hr-leave', actionSlug: 'approve' }).allowed;
                const permitted = await getPermittedBranchIds(user);
                const branchId = attachment.leaveApplication.employee.branchId;
                const inScope = permitted === null || (!!branchId && permitted.includes(branchId));
                if (!canApprove || !inScope) return errorResponse('You do not have access to this attachment', 403);
            }

            const url = await getSignedReadUrl(attachment.fileKey);
            return successResponse({ url, fileName: attachment.fileName, mimeType: attachment.mimeType, fileSize: attachment.fileSize }, 'Attachment link generated');
        } catch (error: any) {
            console.error('Error opening leave attachment:', error);
            return errorResponse(error.message || 'Failed to open attachment', 500);
        }
    })(request);
}
