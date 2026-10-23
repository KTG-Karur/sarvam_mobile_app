import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { errorResponse, handleCorsPreflight, successResponse, withRole } from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function OPTIONS() {
  return handleCorsPreflight();
}

/**
 * GET /api/eod-close-requests/pending
 * Area Manager / Admin inbox — branches with an EOD submission awaiting approval.
 *
 * @access AREA_MANAGER, ADMIN
 */
export async function GET(req: NextRequest) {
  return withRole(['AREA_MANAGER', 'ADMIN'], async (_req, user) => {
    try {
      const permittedBranchIds = await getPermittedBranchIds(user);
      if (permittedBranchIds !== null && permittedBranchIds.length === 0) {
        return successResponse({ requests: [] }, 'No branches assigned');
      }

      const requests = await prisma.eodCloseRequest.findMany({
        where: {
          status: 'PENDING_AM_APPROVAL',
          ...(permittedBranchIds !== null ? { branchId: { in: permittedBranchIds } } : {}),
        },
        include: {
          branch: { select: { id: true, name: true, code: true } },
          submittedBy: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { submittedAt: 'asc' },
      });

      return successResponse(
        {
          requests: requests.map((r) => ({
            id: r.id,
            branchId: r.branchId,
            branchName: r.branch.name,
            branchCode: r.branch.code,
            workingDateYmd: r.workingDateYmd,
            totalAmount: Number(r.totalAmount),
            expectedCashCreditTotal: Number(r.expectedCashCreditTotal),
            difference: Number(r.expectedCashCreditTotal) - Number(r.totalAmount),
            submittedBy: `${r.submittedBy.firstName} ${r.submittedBy.lastName}`.trim(),
            submittedById: r.submittedById,
            submittedAt: r.submittedAt,
          })),
        },
        'Pending EOD approvals fetched'
      );
    } catch (error) {
      console.error('[EOD Close Request] pending GET Error:', error);
      return errorResponse('Failed to fetch pending EOD approvals', 500);
    }
  })(req);
}
