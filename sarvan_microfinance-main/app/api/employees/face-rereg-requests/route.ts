import { NextRequest } from 'next/server';
import * as z from 'zod';
import { prisma } from '@/app/lib/db';
import {
  handleCorsPreflight,
  errorResponse,
  successResponse,
  withAuth,
} from '@/app/lib/api-utils';
import { isSubAdminUser } from '@/app/lib/permissions/sub-admin';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { istDayStart, istDayEnd } from '@/app/lib/ist-date-range';

const listQuerySchema = z.object({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'COMPLETED']).optional(),
  branchId: z.string().min(1).optional(),
  search: z.string().min(1).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

export async function OPTIONS() {
  return handleCorsPreflight();
}

/**
 * GET /api/employees/face-rereg-requests
 * Admin / Sub Admin only. Lists face re-registration approval requests.
 */
export async function GET(request: NextRequest) {
  return withAuth(async (req, user) => {
    try {
      const isSubAdmin = user.role !== 'ADMIN' && (await isSubAdminUser(user.userId));
      if (user.role !== 'ADMIN' && !isSubAdmin) {
        return errorResponse('Insufficient permissions', 403);
      }

      const { searchParams } = new URL(req.url);
      const parsed = listQuerySchema.safeParse(Object.fromEntries(searchParams.entries()));
      if (!parsed.success) {
        return errorResponse(parsed.error.issues.map((i) => i.message).join(', '), 400);
      }
      const { status, branchId, search, from, to, page, pageSize } = parsed.data;

      const permittedBranchIds = await getPermittedBranchIds(user);
      if (permittedBranchIds !== null && branchId && !permittedBranchIds.includes(branchId)) {
        return errorResponse('You do not have access to this branch', 403);
      }

      const userWhere: Record<string, unknown> = {};
      if (permittedBranchIds !== null) {
        userWhere.branchId = { in: permittedBranchIds };
      }
      if (branchId) {
        userWhere.branchId = branchId;
      }
      if (search) {
        userWhere.OR = [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { employeeId: { contains: search, mode: 'insensitive' } },
        ];
      }

      const where: Record<string, unknown> = {
        ...(status ? { status } : {}),
        ...(Object.keys(userWhere).length > 0 ? { user: userWhere } : {}),
      };
      if (from || to) {
        where.requestedAt = {
          ...(from ? { gte: istDayStart(from) } : {}),
          ...(to ? { lte: istDayEnd(to) } : {}),
        };
      }

      const [totalCount, requests] = await Promise.all([
        prisma.faceReRegistrationRequest.count({ where }),
        prisma.faceReRegistrationRequest.findMany({
          where,
          orderBy: { requestedAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true,
            status: true,
            reason: true,
            requestedAt: true,
            approvedAt: true,
            rejectedAt: true,
            rejectionReason: true,
            completedAt: true,
            user: {
              select: {
                id: true,
                employeeId: true,
                firstName: true,
                lastName: true,
                branch: { select: { id: true, name: true, code: true } },
              },
            },
            approvedBy: { select: { id: true, firstName: true, lastName: true } },
            rejectedBy: { select: { id: true, firstName: true, lastName: true } },
          },
        }),
      ]);

      return successResponse(
        {
          requests: requests.map((r) => ({
            id: r.id,
            status: r.status,
            reason: r.reason,
            requestedAt: r.requestedAt.toISOString(),
            approvedAt: r.approvedAt?.toISOString() ?? null,
            rejectedAt: r.rejectedAt?.toISOString() ?? null,
            rejectionReason: r.rejectionReason,
            completedAt: r.completedAt?.toISOString() ?? null,
            employee: r.user,
            approvedBy: r.approvedBy,
            rejectedBy: r.rejectedBy,
          })),
          totalCount,
          totalPages: Math.ceil(totalCount / pageSize),
          page,
          pageSize,
        },
        'Face re-registration requests fetched successfully'
      );
    } catch (error) {
      console.error('Error fetching face re-registration requests:', error);
      return errorResponse('Failed to fetch face re-registration requests', 500);
    }
  })(request);
}
