import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/prisma';
import {
  handleCorsPreflight,
  errorResponse,
  successResponse,
  withRole,
} from '@/app/lib/api-utils';

export async function OPTIONS() {
  return handleCorsPreflight();
}

const deleteSchema = z.object({
  indexIds: z.array(z.string().min(1)).min(1, 'At least one disbursement must be selected'),
});

/**
 * POST /api/disbursements/delete
 *
 * "Deletes" a disbursement batch by reverting loans that were sent for Level-2:
 * - PENDING_LEVEL2 -> PENDING_LEVEL1 (back to pre-approval state)
 * - clears Level-1/Level-2 metadata that belongs to the disbursement flow
 *
 * IMPORTANT: This does NOT delete loans, clients, or indexes. It only reverts the disbursement state.
 *
 * BRANCH_MANAGER only.
 */
export async function POST(request: NextRequest) {
  return withRole(['BRANCH_MANAGER', 'ADMIN'], async (req, user) => {
    try {
      const body = await req.json();
      const { indexIds } = deleteSchema.parse(body);

      // Load indexes and validate branch ownership
      const indexes = await prisma.loanIndex.findMany({
        where: { id: { in: indexIds } },
        select: {
          id: true,
          indexNo: true,
          center: { select: { branchId: true } },
        },
      });

      if (indexes.length !== indexIds.length) {
        return errorResponse('One or more disbursement batches were not found', 404);
      }

      // Branch ownership check for BM only (admins can access all)
      if (user.role === 'BRANCH_MANAGER') {
        const bm = await prisma.user.findUnique({
          where: { id: user.userId },
          select: { branchId: true },
        });
        if (!bm?.branchId) {
          return errorResponse('User branch not found', 400);
        }

        const unauthorized = indexes.find((i) => i.center.branchId !== bm.branchId);
        if (unauthorized) {
          return errorResponse(
            'Insufficient permissions: One or more items are not in your branch',
            403
          );
        }
      }

      // Prevent reverting indexes that already have finalized disbursement
      const hasFinalized = await prisma.loan.findFirst({
        where: {
          indexId: { in: indexIds },
          isActive: true,
          disbursementStatus: { in: ['DISBURSED', 'REJECTED'] },
        },
        select: { id: true },
      });

      if (hasFinalized) {
        return errorResponse(
          'Cannot delete/revert: one or more selected batches contain finalized loans (DISBURSED/REJECTED).',
          400
        );
      }

      const result = await prisma.$transaction(async (tx) => {
        // Revert only loans that are still pending at Level-2
        const update = await tx.loan.updateMany({
          where: {
            indexId: { in: indexIds },
            isActive: true,
            disbursementStatus: 'PENDING_LEVEL2',
          },
          data: {
            disbursementStatus: 'PENDING_LEVEL1',
            disbursedLevel1ById: null,
            disbursedLevel1At: null,
            approvedLevel2ById: null,
            approvedLevel2At: null,
            rejectionReason: null,
          },
        });

        return update.count;
      });

      return successResponse(
        { revertedLoans: result, indexIds },
        'Disbursement(s) reverted successfully'
      );
    } catch (error) {
      if (error instanceof z.ZodError) {
        return errorResponse(
          `Validation error: ${error.errors.map((e) => e.message).join(', ')}`,
          400
        );
      }

      console.error('Error reverting disbursements:', error);
      return errorResponse(
        error instanceof Error ? error.message : 'Failed to delete disbursements',
        500
      );
    }
  })(request);
}

