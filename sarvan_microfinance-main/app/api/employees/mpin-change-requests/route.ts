import { NextRequest } from 'next/server';
import * as z from 'zod';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
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

/**
 * @swagger
 * /api/employees/mpin-change-requests:
 *   get:
 *     tags:
 *       - Employees
 *     summary: List mobile MPIN change requests
 *     description: Admin/Sub Admin only. Never returns employee.mpinHash or any MPIN value.
 *     responses:
 *       200:
 *         description: Paginated list of MPIN change requests
 *       403:
 *         description: Admin/Sub Admin access required
 */

export async function OPTIONS() {
  return handleCorsPreflight();
}

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

      // Multi-tenancy boundary — an unrestricted (HO) caller sees everything; a
      // branch-scoped Sub Admin only sees requests from employees in their permitted
      // branches. Employees with a null branchId (e.g. AREA_MANAGER) are excluded from
      // any branch-scoped view by design — they're only visible to unrestricted callers.
      const permittedBranchIds = await getPermittedBranchIds(user);
      if (permittedBranchIds !== null && branchId && !permittedBranchIds.includes(branchId)) {
        return errorResponse('You do not have access to this branch', 403);
      }

      const employeeWhere: Record<string, unknown> = {};
      if (permittedBranchIds !== null) {
        employeeWhere.branchId = { in: permittedBranchIds };
      }
      if (branchId) {
        employeeWhere.branchId = branchId;
      }
      if (search) {
        employeeWhere.OR = [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { employeeId: { contains: search, mode: 'insensitive' } },
        ];
      }

      const where: Record<string, unknown> = {
        ...(status ? { status } : {}),
        ...(Object.keys(employeeWhere).length > 0 ? { employee: employeeWhere } : {}),
      };
      if (from || to) {
        where.requestedAt = {
          ...(from ? { gte: istDayStart(from) } : {}),
          ...(to ? { lte: istDayEnd(to) } : {}),
        };
      }

      const [totalCount, requests] = await Promise.all([
        prisma.mpinChangeRequest.count({ where }),
        prisma.mpinChangeRequest.findMany({
          where,
          orderBy: { requestedAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true,
            status: true,
            requestedAt: true,
            approvedAt: true,
            rejectedAt: true,
            rejectionReason: true,
            completedAt: true,
            employee: {
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
            requestedAt: r.requestedAt.toISOString(),
            approvedAt: r.approvedAt?.toISOString() ?? null,
            rejectedAt: r.rejectedAt?.toISOString() ?? null,
            rejectionReason: r.rejectionReason,
            completedAt: r.completedAt?.toISOString() ?? null,
            employee: r.employee,
            approvedBy: r.approvedBy,
            rejectedBy: r.rejectedBy,
          })),
          totalCount,
          totalPages: Math.ceil(totalCount / pageSize),
          page,
          pageSize,
        },
        'MPIN change requests fetched successfully'
      );
    } catch (error) {
      console.error('Error fetching MPIN change requests:', error);
      return errorResponse('Failed to fetch MPIN change requests', 500);
    }
  })(request);
}
