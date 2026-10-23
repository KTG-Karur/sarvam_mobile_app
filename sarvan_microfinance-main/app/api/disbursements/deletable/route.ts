import { NextRequest } from 'next/server';
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

/**
 * GET /api/disbursements/deletable?centerId=...
 *
 * Returns "disbursement batches" that are safe to delete/revert.
 * In this system, a batch maps to a `LoanIndex` that currently has loans in `PENDING_LEVEL2`
 * (i.e., sent for Level-2 approval but not yet finalized).
 *
 * BRANCH_MANAGER only (matches UI route protection).
 */
export async function GET(request: NextRequest) {
  return withRole(['BRANCH_MANAGER', 'ADMIN'], async (req, user) => {
    try {
      const { searchParams } = new URL(req.url);
      const centerId = searchParams.get('centerId');

      if (!centerId) {
        return errorResponse('Center ID is required', 400);
      }

      const center = await prisma.center.findUnique({
        where: { id: centerId },
        select: { id: true, branchId: true, code: true, name: true },
      });

      if (!center) {
        return errorResponse('Center not found', 404);
      }

      // Authorize: center must belong to BM's branch (admins can access all)
      if (user.role === 'BRANCH_MANAGER') {
        const bm = await prisma.user.findUnique({
          where: { id: user.userId },
          select: { branchId: true },
        });

        if (!bm?.branchId) {
          return errorResponse('User branch not found', 400);
        }

        if (center.branchId !== bm.branchId) {
          return errorResponse('Insufficient permissions: Center is not in your branch', 403);
        }
      }

      const indexes = await prisma.loanIndex.findMany({
        where: {
          centerId,
          isActive: true,
          loans: {
            some: { isActive: true, disbursementStatus: 'PENDING_LEVEL2' },
          },
        },
        select: {
          id: true,
          indexNo: true,
          indexDate: true,
          center: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
          loans: {
            where: { isActive: true, disbursementStatus: 'PENDING_LEVEL2' },
            select: {
              amount: true,
              disbursedLevel1At: true,
            },
          },
        },
        orderBy: { indexDate: 'desc' },
      });

      const disbursements = indexes.map((idx) => {
        const totalAmount = idx.loans.reduce((sum, l) => sum + Number(l.amount), 0);
        const totalClients = idx.loans.length;

        // Use latest Level-1 disbursement timestamp as "disbursal date"
        const disbursalDate =
          idx.loans
            .map((l) => l.disbursedLevel1At)
            .filter((d): d is Date => Boolean(d))
            .sort((a, b) => b.getTime() - a.getTime())[0] ?? idx.indexDate;

        return {
          id: idx.id,
          disbursementId: `DISB-${idx.indexNo}`,
          indexNo: idx.indexNo,
          indexDate: idx.indexDate.toISOString().split('T')[0],
          centerId: idx.center.id,
          centerCode: idx.center.code,
          centerName: idx.center.name,
          // NOTE: This project currently does not persist funder for disbursement.
          // Keeping this field for UI compatibility.
          funderName: 'N/A',
          totalClients,
          totalAmount,
          disbursalDate: disbursalDate.toISOString().split('T')[0],
        };
      });

      return successResponse(disbursements, 'Deletable disbursements fetched successfully');
    } catch (error) {
      console.error('Error fetching deletable disbursements:', error);
      return errorResponse(
        error instanceof Error ? error.message : 'Failed to fetch disbursements',
        500
      );
    }
  })(request);
}

