import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/prisma';
import { errorResponse, handleCorsPreflight, successResponse, withRole } from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function OPTIONS() {
  return handleCorsPreflight();
}

const bodySchema = z.object({
  rejectionReason: z.string().trim().min(1, 'Rejection reason is required'),
});

/**
 * POST /api/eod-close-requests/:id/reject
 * Checker action: sends the submission back to the BM with a reason. No domain
 * mutation happens here — nothing was applied at submit time, so there is
 * nothing to undo. The BM can correct and resubmit via POST /api/eod-close-requests.
 *
 * @access AREA_MANAGER, ADMIN
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withRole(['AREA_MANAGER', 'ADMIN'], async (req, user) => {
    const { id } = await ctx.params;
    if (!id) return errorResponse('EOD close request id is required', 400);

    const parsed = bodySchema.safeParse((await req.json().catch(() => ({}))) as unknown);
    if (!parsed.success) {
      return errorResponse(parsed.error.issues.map((i) => i.message).join(', '), 400);
    }

    const requestRecord = await prisma.eodCloseRequest.findUnique({ where: { id } });
    if (!requestRecord) return errorResponse('EOD close request not found', 404);

    const permittedBranchIds = await getPermittedBranchIds(user);
    if (permittedBranchIds !== null && !permittedBranchIds.includes(requestRecord.branchId)) {
      return errorResponse("You do not have access to this branch's EOD approvals", 403);
    }

    if (requestRecord.status === 'REJECTED') {
      return successResponse({ id: requestRecord.id, status: requestRecord.status }, 'EOD already rejected');
    }
    if (requestRecord.status !== 'PENDING_AM_APPROVAL') {
      return errorResponse(`Invalid state: ${requestRecord.status}`, 409);
    }

    if (requestRecord.submittedById === user.userId) {
      return errorResponse('Self-rejection is not meaningful — this is a checker action', 400);
    }

    const updated = await prisma.eodCloseRequest.update({
      where: { id: requestRecord.id },
      data: {
        status: 'REJECTED',
        reviewedById: user.userId,
        reviewedAt: new Date(),
        rejectionReason: parsed.data.rejectionReason,
      },
    });

    return successResponse(
      { id: updated.id, status: updated.status, rejectionReason: updated.rejectionReason },
      'EOD submission rejected'
    );
  })(request);
}
