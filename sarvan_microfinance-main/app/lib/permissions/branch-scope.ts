import { getAreaManagerBranchIds } from '@/app/lib/am-branch-utils';
import { getUserAssignedBranchIds } from '@/app/lib/user-branch-assignments';
import { isHeadOfficeBranch } from '@/app/lib/head-office-branch';
import { getOrgScope } from '@/app/lib/permissions/org-scope';
import { prisma } from '@/app/lib/db';

/**
 * Minimal shape these helpers actually need — deliberately narrower than the
 * full `JWTPayload` so callers that only have a partial user object (e.g. a
 * report-layer function that was handed `{ userId, role, branchId }`) can pass
 * it straight through without constructing a fake full JWTPayload. Every real
 * `JWTPayload` already satisfies this structurally.
 */
export type BranchScopeUser = {
  userId: string;
  role: string;
  branchId?: string | null;
  assignedBranchIds?: string[];
};

/**
 * Returns the set of branchIds a user is permitted to see report/dashboard data for.
 * `null` means unrestricted (Head Office based user) — the caller may then honor
 * any client-requested branchId, or omit branch filtering entirely for a
 * company-wide view.
 *
 * - ADMIN with no active-branch context at all: fully unrestricted.
 * - Anyone whose active branch resolves to Head Office (ADMIN included, plus
 *   any dynamic-RBAC role such as "Zonal Head"/"Division Manager" based at
 *   HO): unrestricted — HO itself has no centers/clients, so pinning them to
 *   just that branch would make every branch-scoped list come back empty.
 * - Anyone (except ADMIN / AREA_MANAGER) with an org scope (UserOrgScope —
 *   Head Office / Region / Division / Area / Branch coverage, e.g. a Quality
 *   Checker): Head Office coverage → unrestricted; otherwise exactly their
 *   assigned + covered branches, EVEN WHEN their active branch is Head Office
 *   (the HO "unrestricted" rule below must not override an explicit
 *   narrower coverage). Read fresh (cached ~30s), not from the JWT, so a
 *   coverage change applies without re-login.
 * - AREA_MANAGER: all branches assigned via AreaManagerBranch (JWT-embedded
 *   assignedBranchIds when present, else a DB lookup for older tokens).
 * - Any other role (BRANCH_MANAGER, FDO, custom RBAC roles, ...): all
 *   branches assigned via UserBranchAssignment (JWT-embedded assignedBranchIds
 *   when present, else a DB lookup) — falling back to just their primary
 *   `branchId` for the common case of a user who was never explicitly
 *   assigned multiple branches, so single-branch users are unaffected.
 */
export async function getPermittedBranchIds(user: BranchScopeUser): Promise<string[] | null> {
  if (user.role === 'ADMIN' && !user.branchId) {
    // Head Office Admin with no active-branch context at all: fully unrestricted.
    return null;
  }

  if (user.role !== 'ADMIN' && user.role !== 'AREA_MANAGER') {
    const orgScope = await getOrgScope(user.userId);
    if (orgScope) {
      if (orgScope.headOffice) return null;
      return getUserAssignedBranchIds(user.userId);
    }
  }

  // Any user — ADMIN or a dynamic-RBAC role (e.g. "Zonal Head", "Division
  // Manager") — whose active branch is Head Office is unrestricted. HO itself
  // has no centers/clients of its own, and page-level access is already
  // gated separately by RBAC page permissions, so branch scoping should let
  // an HO-based user pick any branch rather than trap them at an empty HO
  // branch (which previously made every center/client/report list come back
  // empty regardless of which branch they selected in a filter).
  if (user.branchId) {
    const isHo = await isHeadOfficeBranch(user.branchId);
    if (isHo) return null;
  }

  // Fast path: modern tokens embed the full assigned-branch list at login
  // (AREA_MANAGER via AreaManagerBranch, everyone else via
  // UserBranchAssignment) — no DB round trip needed.
  if (user.assignedBranchIds && user.assignedBranchIds.length > 0) {
    return user.assignedBranchIds;
  }

  if (user.role === 'AREA_MANAGER') {
    return getAreaManagerBranchIds(user.userId);
  }

  const assigned = await getUserAssignedBranchIds(user.userId);
  if (assigned.length > 0) return assigned;

  return user.branchId ? [user.branchId] : [];
}

/**
 * Resolves the branchId(s) to actually filter a report by, given an optional
 * client-requested branchId (query param / header). Fails safe: a requested
 * branch outside the caller's permitted set is ignored rather than honored —
 * mirrors the pattern in app/api/dashboard/v2/route.ts.
 *
 * Returns `null` only for an unrestricted Head Office ADMIN with no request
 * (i.e. a genuine "all branches" company-wide view).
 */
export async function resolveScopedBranchIds(
  user: BranchScopeUser,
  requestedBranchId?: string | null
): Promise<string[] | null> {
  const permitted = await getPermittedBranchIds(user);

  if (permitted === null) {
    return requestedBranchId && requestedBranchId !== 'all' ? [requestedBranchId] : null;
  }

  if (!requestedBranchId || requestedBranchId === 'all') {
    return permitted;
  }

  return permitted.includes(requestedBranchId) ? [requestedBranchId] : permitted;
}

/**
 * Convenience wrapper for the common case of filtering a single-branchId
 * Prisma `where` clause. Returns `{}` (no filter) only for an unrestricted
 * Head Office ADMIN with no specific branch requested.
 */
export async function buildBranchWhereClause(
  user: BranchScopeUser,
  requestedBranchId?: string | null
): Promise<{ branchId?: string | { in: string[] } }> {
  const branchIds = await resolveScopedBranchIds(user, requestedBranchId);
  if (branchIds === null) return {};
  if (branchIds.length === 1) return { branchId: branchIds[0] };
  return { branchId: { in: branchIds } };
}

/**
 * Same result as {@link getPermittedBranchIds}, for routes that only hold an RBAC
 * `UserContext` (requirePermission) instead of the withAuth JWT user. Using this keeps
 * "all branches" identical to the employee picker / summary reports; reading
 * `ctx.branchAccess` directly returns `[]` (an empty report) for users with no
 * UserBranchAccess rows.
 */
export async function getPermittedBranchIdsForContext(ctx: { userId: string; branchId: string | null }): Promise<string[] | null> {
  const row = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { role: true, branchId: true } });
  return getPermittedBranchIds({
    userId: ctx.userId,
    role: row?.role ?? '',
    branchId: ctx.branchId ?? row?.branchId ?? null,
  });
}
