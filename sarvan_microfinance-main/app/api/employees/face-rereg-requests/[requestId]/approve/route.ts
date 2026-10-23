import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import {
  errorResponse,
  handleCorsPreflight,
  successResponse,
  withAuth,
} from '@/app/lib/api-utils';
import { isSubAdminUser } from '@/app/lib/permissions/sub-admin';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function OPTIONS() {
  return handleCorsPreflight();
}

/**
 * POST /api/employees/face-rereg-requests/{requestId}/approve
 * Admin / Sub Admin only. Clears the employee to re-register their face; the
 * employee still captures the new template themselves via /api/auth/face/register.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const { requestId } = await params;
  return withAuth(async (_req, user) => {
    try {
      const isSubAdmin = user.role !== 'ADMIN' && (await isSubAdminUser(user.userId));
      if (user.role !== 'ADMIN' && !isSubAdmin) {
        return errorResponse('Insufficient permissions', 403);
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

      if (requestRecord.status === 'APPROVED') {
        return successResponse({ id: requestRecord.id, status: requestRecord.status }, 'Request already approved');
      }
      if (requestRecord.status !== 'PENDING') {
        return errorResponse(`Invalid state: ${requestRecord.status}`, 409);
      }

      await prisma.faceReRegistrationRequest.update({
        where: { id: requestId },
        data: { status: 'APPROVED', approvedById: user.userId, approvedAt: new Date() },
      });

      return successResponse({ id: requestId, status: 'APPROVED' }, 'Face re-registration request approved successfully');
    } catch (error) {
      console.error('Error approving face re-registration request:', error);
      return errorResponse('Failed to approve face re-registration request', 500);
    }
  })(request);
}
