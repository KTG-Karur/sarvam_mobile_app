import { prisma } from '@/app/lib/db';

/** Max branches per Area Manager (business rule). */
export const AM_MAX_BRANCHES = 4;

/**
 * Returns all assigned branch IDs for an Area Manager.
 * Used for filtering the branch-switch list in the UI.
 */
export async function getAreaManagerBranchIds(userId: string): Promise<string[]> {
  const assignments = await prisma.areaManagerBranch.findMany({
    where: { userId },
    select: { branchId: true },
  });
  return assignments.map((a) => a.branchId);
}

/**
 * Returns full branch details for all branches assigned to an AM.
 */
export async function getAreaManagerBranches(userId: string) {
  const assignments = await prisma.areaManagerBranch.findMany({
    where: { userId },
    orderBy: { isPrimary: 'desc' },
    select: {
      id: true,
      isPrimary: true,
      createdAt: true,
      branch: {
        select: {
          id: true,
          name: true,
          code: true,
          address: true,
          isActive: true,
        },
      },
    },
  });
  return assignments;
}

/**
 * Returns true if the given Area Manager is assigned to the given branch.
 * Used in the active-branch API and getAuthenticatedUser guard.
 */
export async function isAmAssignedToBranch(
  userId: string,
  branchId: string
): Promise<boolean> {
  const count = await prisma.areaManagerBranch.count({
    where: { userId, branchId },
  });
  return count > 0;
}

/**
 * Returns the current count of branch assignments for an AM.
 */
export async function getAmBranchAssignmentCount(userId: string): Promise<number> {
  return prisma.areaManagerBranch.count({ where: { userId } });
}
