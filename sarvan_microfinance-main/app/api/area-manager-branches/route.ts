import { NextRequest } from 'next/server';
import * as z from 'zod';
import { prisma } from '@/app/lib/db';
import {
  errorResponse,
  successResponse,
  withAuth,
  handleCorsPreflight,
} from '@/app/lib/api-utils';
import {
  AM_MAX_BRANCHES,
  getAmBranchAssignmentCount,
  getAreaManagerBranches,
} from '@/app/lib/am-branch-utils';
import { isHeadOfficeBranch } from '@/app/lib/head-office-branch';

export async function OPTIONS() {
  return handleCorsPreflight();
}

const assignSchema = z.object({
  userId: z.string().min(1, 'userId is required'),
  branchIds: z
    .array(z.string().min(1))
    .min(1, 'At least one branchId is required')
    .max(AM_MAX_BRANCHES, `Cannot assign more than ${AM_MAX_BRANCHES} branches at once`),
  primaryBranchId: z.string().optional(),
});

/**
 * GET /api/area-manager-branches?userId=X
 * Returns all branch assignments for the given AM (Admin only or self for AM).
 */
export async function GET(request: NextRequest) {
  return withAuth(async (req, user) => {
    try {
      const { searchParams } = new URL(req.url);
      const userId = searchParams.get('userId');

      if (!userId) {
        return errorResponse('userId query parameter is required', 400);
      }

      // Only ADMIN or the AM themselves can query their own assignments
      if (user.role !== 'ADMIN' && user.userId !== userId) {
        return errorResponse('Insufficient permissions', 403);
      }

      // Validate the target user is actually an AM
      const targetUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true },
      });

      if (!targetUser) {
        return errorResponse('User not found', 404);
      }

      if (targetUser.role !== 'AREA_MANAGER') {
        return errorResponse('Target user is not an Area Manager', 400);
      }

      const assignments = await getAreaManagerBranches(userId);
      return successResponse(assignments, 'Area manager branches fetched successfully');
    } catch (error) {
      console.error('Error fetching AM branches:', error);
      return errorResponse('Failed to fetch area manager branches', 500);
    }
  })(request);
}

/**
 * POST /api/area-manager-branches
 * Assign one or more branches to an AM. Enforces max-4 rule.
 * Body: { userId, branchIds: string[], primaryBranchId?: string }
 */
export async function POST(request: NextRequest) {
  return withAuth(async (req, user) => {
    try {
      if (user.role !== 'ADMIN') {
        return errorResponse('Only Admins can assign branches to Area Managers', 403);
      }

      const body = await req.json().catch(() => ({}));
      const parsed = assignSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse(parsed.error.errors[0]?.message || 'Invalid request body', 400);
      }

      const { userId, branchIds, primaryBranchId } = parsed.data;

      // 1. Validate target user is an AM
      const targetUser = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, role: true },
      });
      if (!targetUser) {
        return errorResponse('User not found', 404);
      }
      if (targetUser.role !== 'AREA_MANAGER') {
        return errorResponse('Target user must be an Area Manager', 400);
      }

      // 2. Check max-4 constraint
      const currentCount = await getAmBranchAssignmentCount(userId);
      const uniqueNewBranchIds = [...new Set(branchIds)];
      const wouldExceed = currentCount + uniqueNewBranchIds.length > AM_MAX_BRANCHES;
      if (wouldExceed) {
        return errorResponse(
          `Area Manager already has ${currentCount} branch(es) assigned. Adding ${uniqueNewBranchIds.length} more would exceed the maximum of ${AM_MAX_BRANCHES}.`,
          422
        );
      }

      // 3. Validate each branch: exists and is active
      for (const branchId of uniqueNewBranchIds) {
        const branch = await prisma.branch.findUnique({
          where: { id: branchId },
          select: { id: true, name: true, code: true, isActive: true },
        });
        if (!branch) {
          return errorResponse(`Branch not found: ${branchId}`, 404);
        }
        if (!branch.isActive) {
          return errorResponse(`Branch "${branch.name}" is not active`, 400);
        }
      }

      // 4. Get existing assignments to handle primaryBranch merging
      const existing = await prisma.areaManagerBranch.findMany({
        where: { userId },
        select: { branchId: true, isPrimary: true },
      });
      const existingIds = new Set(existing.map((e) => e.branchId));
      const isFirstAssignment = existing.length === 0;

      // 5. Determine the primary branch
      //    - If explicitly provided, use it
      //    - If first-ever assignment and no primary provided, use the first in list
      //    - Otherwise, keep existing primary
      const effectivePrimary =
        primaryBranchId ??
        (isFirstAssignment ? uniqueNewBranchIds[0] : null);

      // 6. Upsert only new branches (skip already-assigned ones)
      const toCreate = uniqueNewBranchIds.filter((id) => !existingIds.has(id));
      const toSkip = uniqueNewBranchIds.filter((id) => existingIds.has(id));

      // 7. Run in a transaction: if setting new primary, clear old primaries first
      const created = await prisma.$transaction(async (tx) => {
        if (effectivePrimary) {
          // Clear any existing primary within this AM's assignments
          await tx.areaManagerBranch.updateMany({
            where: { userId },
            data: { isPrimary: false },
          });
        }

        const rows = await Promise.all(
          toCreate.map((branchId) =>
            tx.areaManagerBranch.create({
              data: {
                userId,
                branchId,
                isPrimary: branchId === effectivePrimary,
              },
              select: {
                id: true,
                isPrimary: true,
                branch: { select: { id: true, name: true, code: true } },
              },
            })
          )
        );

        // If primary is one of the existing (already-assigned) branches, update it
        if (effectivePrimary && existingIds.has(effectivePrimary)) {
          await tx.areaManagerBranch.updateMany({
            where: { userId, branchId: effectivePrimary },
            data: { isPrimary: true },
          });
        }

        return rows;
      });

      return successResponse(
        { created, skipped: toSkip },
        `${created.length} branch(es) assigned successfully${toSkip.length ? `. ${toSkip.length} already assigned (skipped).` : ''}`,
        201
      );
    } catch (error) {
      console.error('Error assigning AM branches:', error);
      return errorResponse('Failed to assign branches', 500);
    }
  })(request);
}

/**
 * DELETE /api/area-manager-branches?id=<assignmentId>
 * Removes a specific branch assignment. Admin only.
 */
export async function DELETE(request: NextRequest) {
  return withAuth(async (req, user) => {
    try {
      if (user.role !== 'ADMIN') {
        return errorResponse('Only Admins can remove branch assignments', 403);
      }

      const { searchParams } = new URL(req.url);
      const id = searchParams.get('id');

      if (!id) {
        return errorResponse('id query parameter is required', 400);
      }

      const assignment = await prisma.areaManagerBranch.findUnique({
        where: { id },
        select: { id: true, isPrimary: true, userId: true },
      });

      if (!assignment) {
        return errorResponse('Assignment not found', 404);
      }

      await prisma.$transaction(async (tx) => {
        await tx.areaManagerBranch.delete({ where: { id } });

        // If the deleted row was primary, promote the next oldest assignment as primary
        if (assignment.isPrimary) {
          const next = await tx.areaManagerBranch.findFirst({
            where: { userId: assignment.userId },
            orderBy: { createdAt: 'asc' },
            select: { id: true },
          });
          if (next) {
            await tx.areaManagerBranch.update({
              where: { id: next.id },
              data: { isPrimary: true },
            });
          }
        }
      });

      return successResponse({ id }, 'Branch assignment removed successfully');
    } catch (error) {
      console.error('Error removing AM branch:', error);
      return errorResponse('Failed to remove branch assignment', 500);
    }
  })(request);
}
