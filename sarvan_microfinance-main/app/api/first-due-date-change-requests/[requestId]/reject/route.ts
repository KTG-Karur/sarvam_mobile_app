import { NextRequest } from 'next/server';
import * as z from 'zod';
import { prisma } from '@/app/lib/prisma';
import { errorResponse, handleCorsPreflight, successResponse, withAuth } from '@/app/lib/api-utils';
import { isSubAdminUser } from '@/app/lib/permissions/sub-admin';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';

const rejectSchema = z.object({
  remarks: z.string().trim().min(3, 'Remarks are required').max(500),
});

export async function OPTIONS() {
  return handleCorsPreflight();
}

/** POST /api/first-due-date-change-requests/{requestId}/reject — Admin / Sub Admin only. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const { requestId } = await params;
  return withAuth(async (req, user) => {
    try {
      if (user.role !== 'ADMIN' && !(await isSubAdminUser(user.userId))) {
        return errorResponse('Insufficient permissions', 403);
      }
      const { remarks } = rejectSchema.parse(await req.json());

      const record = await prisma.firstDueDateChangeRequest.findUnique({
        where: { id: requestId },
        select: { id: true, branchId: true },
      });
      if (!record) return errorResponse('Request not found', 404);

      const permittedBranchIds = await getPermittedBranchIds(user);
      if (permittedBranchIds !== null && !permittedBranchIds.includes(record.branchId)) {
        return errorResponse('You do not have access to this branch', 403);
      }

      const res = await prisma.firstDueDateChangeRequest.updateMany({
        where: { id: requestId, status: 'PENDING' },
        data: { status: 'REJECTED', decidedById: user.userId, decidedAt: new Date(), decisionRemarks: remarks },
      });
      if (res.count === 0) return errorResponse('Request is no longer pending', 409);

      return successResponse({ id: requestId, status: 'REJECTED' }, 'Request rejected');
    } catch (error) {
      if (error instanceof z.ZodError) return errorResponse(error.issues[0].message, 400);
      console.error('Error rejecting first due date change request:', error);
      return errorResponse(error instanceof Error ? error.message : 'Failed to reject request', 500);
    }
  })(request);
}
