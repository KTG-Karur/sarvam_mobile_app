import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { errorResponse, handleCorsPreflight, successResponse, withRole } from '@/app/lib/api-utils';
import { assertBranchNotLocked, BRANCH_LOCK_TIMEZONE } from '@/app/lib/branch-lock';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { computeEodChecklist } from '@/app/lib/eod-checklist';
import { closeEodForBranch, EodCloseError } from '@/app/lib/eod-close';

export async function OPTIONS() {
  return handleCorsPreflight();
}

/**
 * POST /api/eod-close-requests/:id/approve
 * Checker action: re-validates the checklist/denomination one final time (guards
 * against new collections/issues arriving while the request sat pending), then
 * closes EOD for the branch — this is the only place the working date actually
 * advances for a BM-initiated close.
 *
 * @access AREA_MANAGER, ADMIN
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withRole(['AREA_MANAGER', 'ADMIN'], async (_req, user) => {
    const { id } = await ctx.params;
    if (!id) return errorResponse('EOD close request id is required', 400);

    const requestRecord = await prisma.eodCloseRequest.findUnique({ where: { id } });
    if (!requestRecord) return errorResponse('EOD close request not found', 404);

    const permittedBranchIds = await getPermittedBranchIds(user);
    if (permittedBranchIds !== null && !permittedBranchIds.includes(requestRecord.branchId)) {
      return errorResponse("You do not have access to this branch's EOD approvals", 403);
    }

    if (requestRecord.status === 'APPROVED') {
      return successResponse({ id: requestRecord.id, status: requestRecord.status }, 'EOD already approved');
    }
    if (requestRecord.status !== 'PENDING_AM_APPROVAL') {
      return errorResponse(`Invalid state: ${requestRecord.status}`, 409);
    }

    if (requestRecord.submittedById === user.userId) {
      return errorResponse('Self-approval is not allowed', 400);
    }

    const lockResponse = await assertBranchNotLocked(requestRecord.branchId);
    if (lockResponse) return lockResponse;

    // Re-validate fresh — new collections/checklist issues may have appeared
    // while this request sat pending AM review.
    const branchLock = await prisma.branchLock.findUnique({
      where: { branchId: requestRecord.branchId },
      select: { currentWorkingDate: true, timezone: true },
    });
    if (!branchLock) return errorResponse('Branch lock not found', 404);

    const timezone = branchLock.timezone || BRANCH_LOCK_TIMEZONE;
    const workingDate = new Date(branchLock.currentWorkingDate);

    const checklistResult = await computeEodChecklist(requestRecord.branchId, workingDate, timezone);
    if (!checklistResult.canCompleteEod) {
      return errorResponse(
        'New checklist issues have appeared since submission — ask the BM to resolve them and resubmit.',
        409
      );
    }

    try {
      await closeEodForBranch(requestRecord.branchId, user);
    } catch (error) {
      if (error instanceof EodCloseError) {
        return errorResponse(error.message, error.status);
      }
      throw error;
    }

    const updated = await prisma.eodCloseRequest.update({
      where: { id: requestRecord.id },
      data: {
        status: 'APPROVED',
        reviewedById: user.userId,
        reviewedAt: new Date(),
      },
    });

    return successResponse({ id: updated.id, status: updated.status }, 'EOD approved and branch closed');
  })(request);
}
