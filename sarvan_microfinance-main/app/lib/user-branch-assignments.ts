import { prisma } from '@/app/lib/db';
import { getOrgScope } from '@/app/lib/permissions/org-scope';

/**
 * Generic multi-branch assignment for ANY role (BRANCH_MANAGER, FDO, custom
 * RBAC roles, etc.) via the `UserBranchAssignment` junction table.
 *
 * AREA_MANAGER keeps its own separate table (`AreaManagerBranch`, see
 * app/lib/am-branch-utils.ts) — this file is for everyone else. A user with
 * zero rows here (the common case — never explicitly multi-branch-assigned)
 * is a single-branch user; every caller of these helpers must fall back to
 * `User.branchId` in that case so existing single-branch users are unaffected.
 *
 * Org scope (`UserOrgScope`: Region / Division / Area coverage, see
 * app/lib/permissions/org-scope.ts) counts as assignment too: its covered
 * branches are merged in here, so the login token, branch switcher,
 * active-branch check and branch scope all treat them exactly like assigned
 * branches. With org scope set, Head Office among the assigned branches
 * expands to every active branch.
 */

/** Returns all assigned branch IDs for a user, from UserBranchAssignment plus their org scope. Empty array = not multi-branch-assigned (caller should fall back to their primary branch). */
export async function getUserAssignedBranchIds(userId: string): Promise<string[]> {
  const [assignments, orgScope] = await Promise.all([
    prisma.userBranchAssignment.findMany({
      where: { userId },
      select: { branchId: true },
    }),
    getOrgScope(userId),
  ]);
  const ids = new Set(assignments.map((a) => a.branchId));
  if (orgScope) {
    if (orgScope.headOffice) {
      const all = await prisma.branch.findMany({ where: { isActive: true }, select: { id: true } });
      for (const b of all) ids.add(b.id);
    } else {
      for (const id of orgScope.branchIds) ids.add(id);
    }
  }
  return [...ids];
}

/** Returns full branch details for all branches assigned to a user. */
export async function getUserAssignedBranches(userId: string) {
  const assignments = await prisma.userBranchAssignment.findMany({
    where: { userId },
    orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
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
 * Returns true if the given user has an explicit UserBranchAssignment row for
 * this branch, or their org scope covers it. Does NOT consider their primary
 * `User.branchId` — callers that
 * want "assigned OR own primary branch" should check `user.branchId === branchId`
 * themselves first (see resolveEodViewBranchId / active-branch route), since a
 * single-branch user has no rows here at all.
 */
export async function isUserAssignedToBranch(
  userId: string,
  branchId: string
): Promise<boolean> {
  // Same set as getUserAssignedBranchIds when an org scope is assigned
  // (Region/Division/Area branches added; Head Office = every branch).
  const orgScope = await getOrgScope(userId);
  if (orgScope) return (await getUserAssignedBranchIds(userId)).includes(branchId);
  const count = await prisma.userBranchAssignment.count({
    where: { userId, branchId },
  });
  return count > 0;
}
