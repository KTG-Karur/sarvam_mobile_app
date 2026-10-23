import { NextRequest } from 'next/server';
import * as z from 'zod';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { isSubAdminUser } from '@/app/lib/permissions/sub-admin';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { getLoginBlockReason, invalidateLoginAccessCache } from '@/app/lib/services/login-access.service';

const listQuerySchema = z.object({
  branchId: z.string().min(1).optional(),
  search: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  status: z.enum(['ALL', 'ACTIVE', 'BLOCKED']).default('ALL'),
  // all=true returns every matching row (Excel export) instead of one page.
  all: z.enum(['true']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

const updateSchema = z
  .object({
    userId: z.string().min(1),
    webLoginEnabled: z.boolean().optional(),
    mobileLoginEnabled: z.boolean().optional(),
  })
  .refine((v) => v.webLoginEnabled !== undefined || v.mobileLoginEnabled !== undefined, {
    message: 'Nothing to update',
  });

/**
 * @swagger
 * /api/employees/login-access:
 *   get:
 *     tags:
 *       - Employees
 *     summary: List employees with web / mobile login access
 *     description: Admin/Sub Admin only. Inactive, deleted and exited employees are always blocked.
 *   patch:
 *     tags:
 *       - Employees
 *     summary: Enable or disable web / mobile login for an employee
 */

export async function OPTIONS() {
  return handleCorsPreflight();
}

async function isAllowed(user: { role: string; userId: string }) {
  return user.role === 'ADMIN' || (await isSubAdminUser(user.userId));
}

export async function GET(request: NextRequest) {
  return withAuth(async (req, user) => {
    try {
      if (!(await isAllowed(user))) return errorResponse('Insufficient permissions', 403);

      const parsed = listQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams.entries()));
      if (!parsed.success) {
        return errorResponse(parsed.error.issues.map((i) => i.message).join(', '), 400);
      }
      const { branchId, search, role, status, all, page, pageSize } = parsed.data;

      const permittedBranchIds = await getPermittedBranchIds(user);
      if (permittedBranchIds !== null && branchId && !permittedBranchIds.includes(branchId)) {
        return errorResponse('You do not have access to this branch', 403);
      }

      const and: Record<string, unknown>[] = [];
      if (permittedBranchIds !== null) and.push({ branchId: { in: permittedBranchIds } });
      if (branchId) and.push({ branchId });
      if (role) and.push({ role });
      if (search) {
        and.push({
          OR: [
            { firstName: { contains: search, mode: 'insensitive' } },
            { lastName: { contains: search, mode: 'insensitive' } },
            { employeeId: { contains: search, mode: 'insensitive' } },
            { mobileNumber: { contains: search } },
          ],
        });
      }
      // Written without NOT(...): a null dateOfExit makes `dateOfExit <= now` NULL in SQL, and
      // NOT(NULL) drops the row, which emptied the Active filter.
      const now = new Date();
      if (status === 'BLOCKED') and.push({ OR: [{ isActive: false }, { dateOfExit: { lte: now } }] });
      if (status === 'ACTIVE') {
        and.push({ isActive: true });
        and.push({ OR: [{ dateOfExit: null }, { dateOfExit: { gt: now } }] });
      }
      const where = and.length ? { AND: and } : {};

      const [totalCount, users] = await Promise.all([
        prisma.user.count({ where }),
        prisma.user.findMany({
          where,
          orderBy: [{ firstName: 'asc' }, { id: 'asc' }],
          ...(all ? {} : { skip: (page - 1) * pageSize, take: pageSize }),
          select: {
            id: true,
            employeeId: true,
            firstName: true,
            lastName: true,
            role: true,
            isActive: true,
            dateOfExit: true,
            webLoginEnabled: true,
            mobileLoginEnabled: true,
            branch: { select: { id: true, name: true, code: true } },
            userRoles: {
              where: { isActive: true },
              select: { role: { select: { name: true } } },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        }),
      ]);

      return successResponse({
        employees: users.map((u) => {
          const reason = getLoginBlockReason(u, 'WEB');
          const accountStatus = reason === 'INACTIVE' || reason === 'EXITED' ? reason : 'ACTIVE';
          return {
            id: u.id,
            employeeId: u.employeeId,
            name: `${u.firstName} ${u.lastName}`.trim(),
            roleName: u.userRoles[0]?.role.name ?? u.role,
            branch: u.branch,
            accountStatus,
            webLoginEnabled: u.webLoginEnabled,
            mobileLoginEnabled: u.mobileLoginEnabled,
          };
        }),
        totalCount,
        totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
        page,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load login access';
      return errorResponse(message, 500);
    }
  })(request);
}

export async function PATCH(request: NextRequest) {
  return withAuth(async (req, user) => {
    try {
      if (!(await isAllowed(user))) return errorResponse('Insufficient permissions', 403);

      const data = updateSchema.parse(await req.json());

      const target = await prisma.user.findUnique({
        where: { id: data.userId },
        select: { id: true, branchId: true },
      });
      if (!target) return errorResponse('Employee not found', 404);

      const permittedBranchIds = await getPermittedBranchIds(user);
      if (permittedBranchIds !== null && (!target.branchId || !permittedBranchIds.includes(target.branchId))) {
        return errorResponse('You do not have access to this employee', 403);
      }

      const updated = await prisma.user.update({
        where: { id: data.userId },
        data: {
          ...(data.webLoginEnabled !== undefined ? { webLoginEnabled: data.webLoginEnabled } : {}),
          ...(data.mobileLoginEnabled !== undefined ? { mobileLoginEnabled: data.mobileLoginEnabled } : {}),
        },
        select: { id: true, webLoginEnabled: true, mobileLoginEnabled: true },
      });
      invalidateLoginAccessCache(data.userId);

      return successResponse(updated, 'Login access updated');
    } catch (error) {
      if (error instanceof z.ZodError) return errorResponse(error.issues[0].message, 400);
      const message = error instanceof Error ? error.message : 'Failed to update login access';
      return errorResponse(message, 500);
    }
  })(request);
}
