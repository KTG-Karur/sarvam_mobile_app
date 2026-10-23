import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, handleCorsPreflight, successResponse, withAuth } from '@/app/lib/api-utils';
import { isSubAdminUser } from '@/app/lib/permissions/sub-admin';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';

/**
 * @swagger
 * /api/employees/mpin-change-requests/{requestId}/approve:
 *   post:
 *     tags:
 *       - Employees
 *     summary: Approve a mobile MPIN change request
 *     description: >
 *       Admin/Sub Admin only. Does NOT generate or set a new MPIN — it only clears the
 *       employee to create one themselves via POST /api/mobile/mpin/change.
 *     responses:
 *       200:
 *         description: Request approved (or already approved — idempotent)
 *       404:
 *         description: Request not found
 *       409:
 *         description: Request already rejected/completed
 */

export async function OPTIONS() {
  return handleCorsPreflight();
}

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

      const requestRecord = await prisma.mpinChangeRequest.findUnique({
        where: { id: requestId },
        select: { id: true, status: true, employee: { select: { branchId: true } } },
      });
      if (!requestRecord) {
        return errorResponse('MPIN change request not found', 404);
      }

      const permittedBranchIds = await getPermittedBranchIds(user);
      if (
        permittedBranchIds !== null &&
        (!requestRecord.employee.branchId || !permittedBranchIds.includes(requestRecord.employee.branchId))
      ) {
        return errorResponse('You do not have access to this employee\'s branch', 403);
      }

      if (requestRecord.status === 'APPROVED') {
        return successResponse({ id: requestRecord.id, status: requestRecord.status }, 'Request already approved');
      }
      if (requestRecord.status !== 'PENDING') {
        return errorResponse(`Invalid state: ${requestRecord.status}`, 409);
      }

      await prisma.mpinChangeRequest.update({
        where: { id: requestId },
        data: { status: 'APPROVED', approvedById: user.userId, approvedAt: new Date() },
      });

      return successResponse({ id: requestId, status: 'APPROVED' }, 'MPIN change request approved successfully');
    } catch (error) {
      console.error('Error approving MPIN change request:', error);
      return errorResponse('Failed to approve MPIN change request', 500);
    }
  })(request);
}
