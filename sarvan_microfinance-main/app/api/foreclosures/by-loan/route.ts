import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, handleCorsPreflight, successResponse, withRole } from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function OPTIONS() {
  return handleCorsPreflight();
}

/**
 * GET /api/foreclosures/by-loan?loanId=...
 * Lightweight status lookup for foreclosure maker–checker UI.
 *
 * @access BRANCH_MANAGER, AREA_MANAGER, ADMIN
 */
export async function GET(request: NextRequest) {
  return withRole(['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN'], async (req, user) => {
    try {
      const foreclosureDelegate = (prisma as unknown as { foreclosureRequest?: unknown })
        .foreclosureRequest as
        | {
            findFirst: typeof prisma.foreclosureRequest.findFirst;
          }
        | undefined;

      if (!foreclosureDelegate) {
        return successResponse({ request: null }, 'No preclosure request found');
      }

      const { searchParams } = new URL(req.url);
      const loanId = searchParams.get('loanId');
      if (!loanId) return errorResponse('loanId is required', 400);

      const record = await foreclosureDelegate.findFirst({
        where: { loanId },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          initiatedAt: true,
          initiatedById: true,
          branchId: true,
          initiatedBy: { select: { id: true, firstName: true, lastName: true, role: true } },
        },
      });

      if (!record) {
        return successResponse({ request: null }, 'No preclosure request found');
      }

      // Role-agnostic branch check — applies to BM, AM, or any other role reaching
      // this route (ADMIN/HO users are unrestricted via a null permitted set).
      const permittedBranchIds = await getPermittedBranchIds(user);
      if (permittedBranchIds !== null && (!record.branchId || !permittedBranchIds.includes(record.branchId))) {
        return errorResponse('Insufficient permissions', 403);
      }

      return successResponse(
        {
          request: {
            id: record.id,
            status: record.status,
            initiatedAt: record.initiatedAt.toISOString(),
            initiatedBy: record.initiatedBy,
          },
        },
        'Preclosure request fetched'
      );
    } catch (error) {
      return errorResponse(
        error instanceof Error ? error.message : 'Failed to fetch preclosure request',
        500
      );
    }
  })(request);
}

