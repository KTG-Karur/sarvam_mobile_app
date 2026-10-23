import { NextRequest } from 'next/server';
import * as z from 'zod';
import { prisma } from '@/app/lib/db';
import {
  errorResponse,
  handleCorsPreflight,
  successResponse,
  withAuth,
} from '@/app/lib/api-utils';
import { isSubAdminUser } from '@/app/lib/permissions/sub-admin';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';

const rejectSchema = z.object({
  reason: z.string().trim().min(1, 'A rejection reason is required'),
});

export async function OPTIONS() {
  return handleCorsPreflight();
}

/**
 * POST /api/employees/face-rereg-requests/{requestId}/reject
 * Admin / Sub Admin only.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const { requestId } = await params;
  return withAuth(async (req, user) => {
    try {
      const isSubAdmin = user.role !== 'ADMIN' && (await isSubAdminUser(user.userId));
      if (user.role !== 'ADMIN' && !isSubAdmin) {
        return errorResponse('Insufficient permissions', 403);
      }

      const body = await req.json().catch(() => ({}));
      const parsed = rejectSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse(parsed.error.issues[0]?.message || 'Invalid input', 400);
      }

      const requestRecord = await prisma.faceReRegistrationRequest.findUnique({
        where: { id: requestId },
        select: { id: true, status: true, user: { select: { branchId: true } } },
      });
      if (!requestRecord) {
        return errorResponse('Face re-registration request not found', 404);
      }

      const permittedBranchIds = await getPermittedBranchIds(user);
      if (
        permittedBranchIds !== null &&
        (!requestRecord.user.branchId || !permittedBranchIds.includes(requestRecord.user.branchId))
      ) {
        return errorResponse("You do not have access to this employee's branch", 403);
      }

      if (requestRecord.status === 'REJECTED') {
        return successResponse({ id: requestRecord.id, status: requestRecord.status }, 'Request already rejected');
      }
      if (requestRecord.status !== 'PENDING') {
        return errorResponse(`Invalid state: ${requestRecord.status}`, 409);
      }

      await prisma.faceReRegistrationRequest.update({
        where: { id: requestId },
        data: {
          status: 'REJECTED',
          rejectedById: user.userId,
          rejectedAt: new Date(),
          rejectionReason: parsed.data.reason,
        },
      });

      return successResponse({ id: requestId, status: 'REJECTED' }, 'Face re-registration request rejected successfully');
    } catch (error) {
      console.error('Error rejecting face re-registration request:', error);
      return errorResponse('Failed to reject face re-registration request', 500);
    }
  })(request);
}
