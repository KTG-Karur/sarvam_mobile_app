import { NextRequest } from 'next/server';
import * as z from 'zod';
import { prisma } from '@/app/lib/db';
import { errorResponse, handleCorsPreflight, successResponse, withAuth } from '@/app/lib/api-utils';
import { isSubAdminUser } from '@/app/lib/permissions/sub-admin';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';

// Required (unlike the optional reviewRemarks on ForeclosureRequest/SavingsRefundRequest) —
// the task spec names a distinct "rejection_reason" field the employee is meant to see.
const rejectSchema = z.object({
  reason: z.string().trim().min(1, 'A rejection reason is required'),
});

/**
 * @swagger
 * /api/employees/mpin-change-requests/{requestId}/reject:
 *   post:
 *     tags:
 *       - Employees
 *     summary: Reject a mobile MPIN change request
 *     description: Admin/Sub Admin only. The employee cannot change their MPIN after rejection until they submit a new request.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - reason
 *             properties:
 *               reason:
 *                 type: string
 *     responses:
 *       200:
 *         description: Request rejected (or already rejected — idempotent)
 *       400:
 *         description: Missing rejection reason
 *       404:
 *         description: Request not found
 *       409:
 *         description: Request already approved/completed
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

      const body = await req.json().catch(() => ({}));
      const parsed = rejectSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse(parsed.error.issues[0]?.message || 'Invalid input', 400);
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

      if (requestRecord.status === 'REJECTED') {
        return successResponse({ id: requestRecord.id, status: requestRecord.status }, 'Request already rejected');
      }
      if (requestRecord.status !== 'PENDING') {
        return errorResponse(`Invalid state: ${requestRecord.status}`, 409);
      }

      await prisma.mpinChangeRequest.update({
        where: { id: requestId },
        data: {
          status: 'REJECTED',
          rejectedById: user.userId,
          rejectedAt: new Date(),
          rejectionReason: parsed.data.reason,
        },
      });

      return successResponse({ id: requestId, status: 'REJECTED' }, 'MPIN change request rejected successfully');
    } catch (error) {
      console.error('Error rejecting MPIN change request:', error);
      return errorResponse('Failed to reject MPIN change request', 500);
    }
  })(request);
}
