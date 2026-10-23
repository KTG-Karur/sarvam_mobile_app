import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { errorResponse, handleCorsPreflight, successResponse, withAuth } from '@/app/lib/api-utils';

export async function OPTIONS() {
  return handleCorsPreflight();
}

/** POST /api/first-due-date-change-requests/{requestId}/cancel — whoever raised it, while still PENDING. */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  const { requestId } = await params;
  return withAuth(async (_req, user) => {
    try {
      const record = await prisma.firstDueDateChangeRequest.findUnique({
        where: { id: requestId },
        select: { requestedById: true },
      });
      if (!record) return errorResponse('Request not found', 404);
      if (record.requestedById !== user.userId) {
        return errorResponse('Only the requester can cancel this request', 403);
      }

      const res = await prisma.firstDueDateChangeRequest.updateMany({
        where: { id: requestId, status: 'PENDING' },
        data: { status: 'CANCELLED', decidedAt: new Date() },
      });
      if (res.count === 0) return errorResponse('Request is no longer pending', 409);

      return successResponse({ id: requestId, status: 'CANCELLED' }, 'Request cancelled');
    } catch (error) {
      console.error('Error cancelling first due date change request:', error);
      return errorResponse(error instanceof Error ? error.message : 'Failed to cancel request', 500);
    }
  })(request);
}
