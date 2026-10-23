import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, handleCorsPreflight, successResponse, withAuth } from '@/app/lib/api-utils';
import { assertBranchNotLocked } from '@/app/lib/branch-lock';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { isSubAdminUser } from '@/app/lib/permissions/sub-admin';
import { z } from 'zod';

export async function OPTIONS() {
  return handleCorsPreflight();
}

const bodySchema = z.object({
  remarks: z.string().trim().optional(),
});

/**
 * POST /api/foreclosures/:id/reject
 *
 * @access AREA_MANAGER, ADMIN, Sub Admin (Role.isSubAdmin)
 */
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  return withAuth(async (req, user) => {
    const { id } = await ctx.params;
    if (!id) return errorResponse('Preclosure request id is required', 400);

    // Sub Admin: a custom role explicitly flagged Role.isSubAdmin === true,
    // treated as Admin-equivalent for this checker step.
    const isSubAdmin = user.role !== 'ADMIN' && user.role !== 'AREA_MANAGER' && await isSubAdminUser(user.userId);
    if (user.role !== 'AREA_MANAGER' && user.role !== 'ADMIN' && !isSubAdmin) {
      return errorResponse('Insufficient permissions', 403);
    }

    const parsed = bodySchema.safeParse((await req.json().catch(() => ({}))) as unknown);
    if (!parsed.success) {
      return errorResponse(parsed.error.issues.map((i) => i.message).join(', '), 400);
    }
    const safeRemarks = parsed.data.remarks?.trim() ? parsed.data.remarks.trim() : null;

    const requestRecord = await prisma.foreclosureRequest.findUnique({
      where: { id },
      select: {
        id: true,
        status: true,
        branchId: true,
        initiatedById: true,
        transactionId: true,
      },
    });
    if (!requestRecord) return errorResponse('Preclosure request not found', 404);

    // Multi-tenancy boundary — an AREA_MANAGER may only reject preclosures
    // for branches they're assigned to.
    const permittedBranchIds = await getPermittedBranchIds(user);
    if (permittedBranchIds !== null && !permittedBranchIds.includes(requestRecord.branchId)) {
      return errorResponse('You do not have access to this branch\'s preclosure requests', 403);
    }

    if (requestRecord.status === 'REJECTED') {
      return successResponse(
        { id: requestRecord.id, status: requestRecord.status },
        'Preclosure already rejected'
      );
    }
    if (requestRecord.status === 'APPROVED') {
      return errorResponse('Preclosure request already approved', 409);
    }
    if (requestRecord.status !== 'PENDING_APPROVAL') {
      return errorResponse(`Invalid state: ${requestRecord.status}`, 409);
    }

    // Admin and Sub Admin may reject a request they initiated themselves —
    // everyone else (AREA_MANAGER) keeps the maker-checker separation.
    if (requestRecord.initiatedById === user.userId && user.role !== 'ADMIN' && !isSubAdmin) {
      return errorResponse('Self-rejection is not allowed', 400);
    }

    const lockResponse = await assertBranchNotLocked(requestRecord.branchId);
    if (lockResponse) return lockResponse;

    await prisma.$transaction(async (tx) => {
      const fresh = await tx.foreclosureRequest.findUnique({
        where: { id: requestRecord.id },
        select: { status: true, transactionId: true },
      });
      if (!fresh) throw new Error('Preclosure request not found');
      if (fresh.status === 'REJECTED') return;
      if (fresh.status !== 'PENDING_APPROVAL') {
        throw new Error(`Invalid state: ${fresh.status}`);
      }

      await tx.foreclosureRequest.update({
        where: { id: requestRecord.id },
        data: {
          status: 'REJECTED',
          reviewedById: user.userId,
          reviewedAt: new Date(),
          reviewRemarks: safeRemarks,
        },
      });

      if (fresh.transactionId) {
        await tx.loanTransaction.update({
          where: { id: fresh.transactionId },
          data: {
            status: 'REJECTED',
            rejectionReason: safeRemarks,
            approvedById: user.userId,
            approvedAt: new Date(),
          },
        });
      }
    });

    return successResponse(
      { id: requestRecord.id, status: 'REJECTED' },
      'Preclosure rejected successfully'
    );
  })(request);
}

