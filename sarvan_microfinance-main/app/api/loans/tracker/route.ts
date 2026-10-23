import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import {
  errorResponse,
  successResponse,
  withAuth,
  handleCorsPreflight,
} from '@/app/lib/api-utils';
import { assertFdoOwnsCenter } from '@/app/lib/filters/fdo-center-scope';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';
import { memberIdSearchConditions } from '@/app/lib/reports/member-contacts';

export async function OPTIONS() {
  return handleCorsPreflight();
}

const USER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  employeeId: true,
} as const;

/**
 * GET /api/loans/tracker
 * Returns loans with full approval trail, scoped by role.
 *
 * Query params:
 *   search          - loanNumber or client name
 *   dateFrom        - ISO date string
 *   dateTo          - ISO date string
 *   branchId        - filter by branch (ADMIN only override)
 *   centerId        - filter by center
 *   applicationStatus
 *   disbursementStatus
 *   page            - default 1
 *   pageSize        - default 20
 */
export async function GET(request: NextRequest) {
  return withAuth(async (req, user) => {
    try {
      const { searchParams } = new URL(req.url);

      const search = searchParams.get('search') || '';
      const dateFrom = searchParams.get('dateFrom');
      const dateTo = searchParams.get('dateTo');
      const branchIdParam = searchParams.get('branchId');
      const centerId = searchParams.get('centerId') || undefined;
      const applicationStatus = searchParams.get('applicationStatus') || undefined;
      const disbursementStatus = searchParams.get('disbursementStatus') || undefined;
      const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
      const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20')));

      // ── Role-based branch scoping ─────────────────────────────────────────
      let branchIds: string[] | undefined;

      if (user.role === 'ADMIN') {
        // ADMIN sees all; may filter by branchId param
        if (branchIdParam) branchIds = [branchIdParam];
      } else if (user.role === 'AREA_MANAGER') {
        // AM sees their assigned branches
        const amBranches = await prisma.areaManagerBranch.findMany({
          where: { userId: user.userId },
          select: { branchId: true },
        });
        const assigned = amBranches.map((b) => b.branchId);
        branchIds = branchIdParam && assigned.includes(branchIdParam)
          ? [branchIdParam]
          : assigned;
        if (branchIds.length === 0) {
          return successResponse({ loans: [], pagination: { page, pageSize, total: 0, totalPages: 0 } }, 'No loans');
        }
      } else {
        // BRANCH_MANAGER/FDO and any other role are scoped to their permitted
        // branches — HO-aware, so a Head-Office-based role (e.g. a dynamic-RBAC
        // "Zonal Head"/"Division Manager") isn't pinned to the empty HO branch
        // and may pick any branch instead, same as ADMIN above.
        const dbUser = await prisma.user.findUnique({
          where: { id: user.userId },
          select: { branchId: true },
        });
        const effectiveUser = { ...user, branchId: user.branchId ?? dbUser?.branchId ?? undefined };
        const resolved = await resolveScopedBranchIds(effectiveUser, branchIdParam);
        if (resolved === null) {
          if (branchIdParam) branchIds = [branchIdParam];
        } else if (resolved.length === 0) {
          return successResponse({ loans: [], pagination: { page, pageSize, total: 0, totalPages: 0 } }, 'No branch assigned');
        } else {
          branchIds = resolved;
        }
      }

      // ── Build where clause ────────────────────────────────────────────────
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const where: Record<string, any> = {};

      if (branchIds) where.branchId = { in: branchIds };

      if (centerId) {
        if (user.role === 'FDO') {
          const center = await prisma.center.findUnique({
            where: { id: centerId },
            select: { fdoId: true },
          });
          if (!center || !assertFdoOwnsCenter(user, center)) {
            return successResponse({ loans: [], pagination: { page, pageSize, total: 0, totalPages: 0 } }, 'No loans');
          }
        }
        where.centerId = centerId;
      } else if (user.role === 'FDO') {
        // No explicit centerId — restrict listing to only the FDO's own centers, not the whole branch
        where.center = { fdoId: user.userId };
      }

      if (applicationStatus) where.applicationStatus = applicationStatus;
      if (disbursementStatus) where.disbursementStatus = disbursementStatus;

      if (dateFrom || dateTo) {
        where.createdAt = {};
        if (dateFrom) where.createdAt.gte = new Date(dateFrom);
        if (dateTo) {
          const end = new Date(dateTo);
          end.setHours(23, 59, 59, 999);
          where.createdAt.lte = end;
        }
      }

      if (search.trim()) {
        where.OR = [
          { loanNumber: { contains: search, mode: 'insensitive' } },
          {
            client: {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { clientId: { contains: search, mode: 'insensitive' } },
                ...memberIdSearchConditions(search),
              ],
            },
          },
        ];
      }

      // ── Query ─────────────────────────────────────────────────────────────
      const [total, loans] = await Promise.all([
        prisma.loan.count({ where }),
        prisma.loan.findMany({
          where,
          skip: (page - 1) * pageSize,
          take: pageSize,
          orderBy: [
            { createdAt: 'desc' },
            { id: 'asc' },
          ],
          select: {
            id: true,
            loanNumber: true,
            amount: true,
            interestRate: true,
            tenureMonths: true,
            frequency: true,
            applicationStatus: true,
            disbursementStatus: true,
            createdAt: true,
            verifiedAt: true,
            disbursedLevel1At: true,
            approvedLevel2At: true,
            disbursedByBMAt: true,
            firstDueDate: true,
            closedDate: true,
            rejectionReason: true,
            client: {
              select: {
                id: true,
                clientId: true,
                firstName: true,
                lastName: true,
                mobileNumber: true,
              },
            },
            center: { select: { id: true, name: true, code: true } },
            branch: { select: { id: true, name: true, code: true } },
            loanProduct: { select: { id: true, productName: true } },
            createdBy: { select: USER_SELECT },
            verifiedBy: { select: USER_SELECT },
            disbursedLevel1By: { select: USER_SELECT },
            approvedLevel2By: { select: USER_SELECT },
            disbursedByBM: { select: USER_SELECT },
          },
        }),
      ]);

      return successResponse(
        {
          loans,
          pagination: {
            page,
            pageSize,
            total,
            totalPages: Math.ceil(total / pageSize),
          },
        },
        'Loans fetched'
      );
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to fetch loans';
      return errorResponse(msg, 500);
    }
  })(request);
}
