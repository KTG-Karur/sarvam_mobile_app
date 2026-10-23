import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import {
  handleCorsPreflight,
  errorResponse,
  successResponse,
  withAuth,
} from '@/app/lib/api-utils';
import { getAreaManagerBranches } from '@/app/lib/am-branch-utils';
import { getUserAssignedBranches } from '@/app/lib/user-branch-assignments';

export function OPTIONS() {
  return handleCorsPreflight();
}

export async function GET(request: NextRequest) {
  return withAuth(async (_req: NextRequest, user) => {
    try {
      const role = user.role;

      if (role === 'ADMIN') {
        const branches = await prisma.branch.findMany({
          where: { isActive: true },
          select: { id: true, name: true, code: true },
          orderBy: { name: 'asc' },
        });
        return successResponse(branches);
      }

      if (role === 'AREA_MANAGER') {
        const assignments = await getAreaManagerBranches(user.userId);
        const branches = assignments
          .filter((a) => a.branch.isActive)
          .map((a) => ({
            id: a.branch.id,
            name: a.branch.name,
            code: a.branch.code,
            isPrimary: a.isPrimary,
          }));
        return successResponse(branches);
      }

      // BRANCH_MANAGER / FDO: return their own branch, plus any extra branches
      // assigned via UserBranchAssignment (e.g. temporary multi-branch coverage).
      const assignments = await getUserAssignedBranches(user.userId);
      if (assignments.length > 0) {
        const branches = assignments
          .filter((a) => a.branch.isActive)
          .map((a) => ({
            id: a.branch.id,
            name: a.branch.name,
            code: a.branch.code,
            isPrimary: a.isPrimary,
          }));
        return successResponse(branches);
      }

      if (!user.branchId) {
        return errorResponse('No branch assigned', 400);
      }
      const branch = await prisma.branch.findUnique({
        where: { id: user.branchId },
        select: { id: true, name: true, code: true },
      });
      if (!branch) return errorResponse('Branch not found', 404);
      return successResponse([branch]);
    } catch (error: any) {
      return errorResponse(error.message || 'Failed to fetch branches', 500);
    }
  })(request);
}
