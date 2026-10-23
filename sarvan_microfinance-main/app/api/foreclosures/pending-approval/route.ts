import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, handleCorsPreflight, successResponse, withRole } from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { z } from 'zod';
import { istDayStart, istDayEnd } from '@/app/lib/ist-date-range';

export async function OPTIONS() {
  return handleCorsPreflight();
}

const querySchema = z.object({
  branchId: z.string().min(1).optional(),
  centerId: z.string().min(1).optional(),
  initiatedById: z.string().min(1).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * GET /api/foreclosures/pending-approval
 * AM queue for foreclosure approvals.
 *
 * Query:
 *  - branchId?: string (defaults to token branch context)
 *  - centerId?: string
 *  - initiatedById?: string (BM)
 *  - from?: ISO datetime
 *  - to?: ISO datetime
 *  - cursor?: string (pagination cursor; uses request id)
 *  - limit?: number (<= 50)
 *
 * @access AREA_MANAGER, ADMIN (approvers), BRANCH_MANAGER (view-only — they're the
 * maker of these requests, surfaced read-only in their Collection Approval workbench;
 * approve/reject stays restricted to AREA_MANAGER/ADMIN in the sibling routes)
 */
export async function GET(request: NextRequest) {
  return withRole(['AREA_MANAGER', 'ADMIN', 'BRANCH_MANAGER'], async (req, user) => {
    const { searchParams } = new URL(req.url);
    const parsed = querySchema.safeParse(Object.fromEntries(searchParams.entries()));
    if (!parsed.success) {
      return errorResponse(parsed.error.issues.map((i) => i.message).join(', '), 400);
    }

    const { branchId, centerId, initiatedById, from, to, cursor, limit } = parsed.data;

    // Multi-tenancy boundary — a client-supplied branchId must never be
    // honored outright; it must be one of the branches this user is actually
    // assigned to (UserBranchAssignment / AreaManagerBranch), or ADMIN's own
    // active branch. With no specific branchId requested, a multi-branch user
    // sees the queue across ALL of their assigned branches at once, not just one.
    const permittedBranchIds = await getPermittedBranchIds(user);
    let branchWhere: string | { in: string[] } | undefined;
    if (permittedBranchIds === null) {
      // Unrestricted HO ADMIN
      branchWhere = branchId;
    } else if (branchId) {
      if (!permittedBranchIds.includes(branchId)) {
        return errorResponse('You do not have access to this branch', 403);
      }
      branchWhere = branchId;
    } else if (permittedBranchIds.length > 0) {
      branchWhere = permittedBranchIds.length === 1 ? permittedBranchIds[0] : { in: permittedBranchIds };
    }
    if (!branchWhere) {
      return errorResponse('Branch context is required', 400);
    }

    const where: Record<string, unknown> = {
      branchId: branchWhere,
      status: 'PENDING_APPROVAL',
    };
    if (centerId) where.centerId = centerId;
    if (initiatedById) where.initiatedById = initiatedById;
    if (from || to) {
      where.createdAt = {
        ...(from ? { gte: istDayStart(from) } : {}),
        ...(to ? { lte: istDayEnd(to) } : {}),
      };
    }

    const items = await prisma.foreclosureRequest.findMany({
      where,
      take: limit + 1,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: [
        { createdAt: 'desc' },
        { id: 'asc' },
      ],
      select: {
        id: true,
        status: true,
        createdAt: true,
        initiatedAt: true,
        amountCollected: true,
        principalAmount: true,
        interestAmount: true,
        penaltyAmount: true,
        feesAmount: true,
        remarks: true,
        loan: {
          select: {
            id: true,
            loanNumber: true,
            amount: true,
            isActive: true,
          },
        },
        client: {
          select: {
            id: true,
            clientId: true,
            firstName: true,
            lastName: true,
            phone: true,
            mobileNumber: true,
          },
        },
        center: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        initiatedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            role: true,
          },
        },
      },
    });

    const hasMore = items.length > limit;
    const pageItems = hasMore ? items.slice(0, limit) : items;
    const nextCursor = hasMore ? pageItems[pageItems.length - 1]?.id ?? null : null;

    return successResponse(
      {
        items: pageItems.map((item) => ({
          id: item.id,
          status: item.status,
          createdAt: item.createdAt.toISOString(),
          initiatedAt: item.initiatedAt.toISOString(),
          remarks: item.remarks,
          amounts: {
            collected: Number(item.amountCollected),
            principal: Number(item.principalAmount),
            interest: Number(item.interestAmount),
            penalty: Number(item.penaltyAmount),
            fees: Number(item.feesAmount),
          },
          center: item.center,
          client: item.client,
          loan: item.loan,
          initiatedBy: item.initiatedBy,
        })),
        page: {
          limit,
          nextCursor,
          hasMore,
        },
      },
      'Pending preclosures fetched successfully'
    );
  })(request);
}

