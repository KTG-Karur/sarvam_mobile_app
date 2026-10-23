import { NextRequest } from 'next/server';
import * as z from 'zod';
import { prisma } from '@/app/lib/prisma';
import { invalidateOrgScopeCache } from '@/app/lib/permissions/org-scope';
import {
  errorResponse,
  successResponse,
  withRole,
  handleCorsPreflight,
} from '@/app/lib/api-utils';

export async function OPTIONS() {
  return handleCorsPreflight();
}

const assignSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  branchIds: z.array(z.string().min(1)).min(1, 'At least one branchId is required'),
  primaryBranchId: z.string().optional(),
});

const patchSchema = z.object({
  isPrimary: z.boolean(),
});

/**
 * GET /api/user-branch-assignments?userId=X
 * Returns all branch assignments for the given user (Admin only).
 */
export async function GET(request: NextRequest) {
  return withRole(['ADMIN'], async (req) => {
    try {
      const { searchParams } = new URL(req.url);
      const userId = searchParams.get('userId');

      if (!userId) {
        return errorResponse('userId query parameter is required', 400);
      }

      const assignments = await prisma.userBranchAssignment.findMany({
        where: { userId },
        include: {
          branch: { select: { id: true, name: true, code: true, isActive: true } },
        },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      });

      return successResponse(assignments, 'Assignments fetched');
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to fetch assignments';
      return errorResponse(msg, 500);
    }
  })(request);
}

/**
 * POST /api/user-branch-assignments
 * Assign one or more branches to a user. Idempotent per (userId, branchId).
 */
export async function POST(request: NextRequest) {
  return withRole(['ADMIN'], async (req) => {
    try {
      const body = await req.json();
      const { userId, branchIds, primaryBranchId } = assignSchema.parse(body);

      const targetUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true },
      });
      if (!targetUser) return errorResponse('User not found', 404);

      await prisma.$transaction(async (tx) => {
        for (const branchId of branchIds) {
          await tx.userBranchAssignment.upsert({
            where: { userId_branchId: { userId, branchId } },
            create: {
              userId,
              branchId,
              isPrimary: primaryBranchId === branchId,
            },
            update: {},
          });
        }

        if (primaryBranchId) {
          // Unset all primaries for this user, then set the chosen one
          await tx.userBranchAssignment.updateMany({
            where: { userId },
            data: { isPrimary: false },
          });
          await tx.userBranchAssignment.update({
            where: { userId_branchId: { userId, branchId: primaryBranchId } },
            data: { isPrimary: true },
          });

          // Keep User.branchId (source of truth for BM/FDO) in sync with the
          // primary assignment so it's reflected wherever the user's branch is
          // displayed. AREA_MANAGER keeps branchId null by design.
          if (targetUser.role !== 'AREA_MANAGER') {
            await tx.user.update({
              where: { id: userId },
              data: { branchId: primaryBranchId },
            });
          }
        }
      });

      // Assigned branches feed the user's Region/Division/Area coverage too.
      invalidateOrgScopeCache(userId);

      const updated = await prisma.userBranchAssignment.findMany({
        where: { userId },
        include: { branch: { select: { id: true, name: true, code: true, isActive: true } } },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      });

      return successResponse(updated, 'Branch(es) assigned successfully');
    } catch (error: unknown) {
      if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
      const msg = error instanceof Error ? error.message : 'Failed to assign branch';
      return errorResponse(msg, 500);
    }
  })(request);
}

/**
 * PATCH /api/user-branch-assignments?id=X
 * Set isPrimary on an assignment.
 */
export async function PATCH(request: NextRequest) {
  return withRole(['ADMIN'], async (req) => {
    try {
      const { searchParams } = new URL(req.url);
      const id = searchParams.get('id');
      if (!id) return errorResponse('id query parameter is required', 400);

      const body = await req.json();
      const { isPrimary } = patchSchema.parse(body);

      const assignment = await prisma.userBranchAssignment.findUnique({ where: { id } });
      if (!assignment) return errorResponse('Assignment not found', 404);

      if (isPrimary) {
        const targetUser = await prisma.user.findUnique({
          where: { id: assignment.userId },
          select: { role: true },
        });

        await prisma.$transaction([
          prisma.userBranchAssignment.updateMany({
            where: { userId: assignment.userId },
            data: { isPrimary: false },
          }),
          prisma.userBranchAssignment.update({
            where: { id },
            data: { isPrimary: true },
          }),
          ...(targetUser && targetUser.role !== 'AREA_MANAGER'
            ? [
                prisma.user.update({
                  where: { id: assignment.userId },
                  data: { branchId: assignment.branchId },
                }),
              ]
            : []),
        ]);
      } else {
        await prisma.userBranchAssignment.update({ where: { id }, data: { isPrimary: false } });
      }

      invalidateOrgScopeCache(assignment.userId);
      return successResponse(null, 'Updated');
    } catch (error: unknown) {
      if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
      const msg = error instanceof Error ? error.message : 'Failed to update assignment';
      return errorResponse(msg, 500);
    }
  })(request);
}

/**
 * DELETE /api/user-branch-assignments?id=X
 * Remove a single branch assignment.
 */
export async function DELETE(request: NextRequest) {
  return withRole(['ADMIN'], async (req) => {
    try {
      const { searchParams } = new URL(req.url);
      const id = searchParams.get('id');
      if (!id) return errorResponse('id query parameter is required', 400);

      const assignment = await prisma.userBranchAssignment.findUnique({ where: { id } });
      if (!assignment) return errorResponse('Assignment not found', 404);

      await prisma.$transaction(async (tx) => {
        await tx.userBranchAssignment.delete({ where: { id } });

        if (assignment.isPrimary) {
          // Promote the next-oldest remaining assignment to primary (if any)
          // and keep User.branchId in sync, mirroring the POST/PATCH behavior.
          const nextPrimary = await tx.userBranchAssignment.findFirst({
            where: { userId: assignment.userId },
            orderBy: { createdAt: 'asc' },
          });
          if (nextPrimary) {
            await tx.userBranchAssignment.update({
              where: { id: nextPrimary.id },
              data: { isPrimary: true },
            });
          }

          const targetUser = await tx.user.findUnique({
            where: { id: assignment.userId },
            select: { role: true },
          });
          if (targetUser && targetUser.role !== 'AREA_MANAGER') {
            await tx.user.update({
              where: { id: assignment.userId },
              data: { branchId: nextPrimary ? nextPrimary.branchId : null },
            });
          }
        }
      });

      invalidateOrgScopeCache(assignment.userId);
      return successResponse(null, 'Branch assignment removed');
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : 'Failed to remove assignment';
      return errorResponse(msg, 500);
    }
  })(request);
}
