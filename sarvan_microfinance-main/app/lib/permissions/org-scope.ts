import { prisma } from '@/app/lib/db';
import { isHeadOfficeBranch } from '@/app/lib/head-office-branch';

/**
 * Org scope: Region / Division / Area coverage assigned to a user (e.g. a
 * Quality Checker) via `UserOrgScope`, combined with their single-branch
 * assignments (`UserBranchAssignment`, the "Manage Branches" list). It works
 * like branch assignment, one level up the hierarchy:
 *
 *   REGION   -> every branch under any Area of any Division in that Region
 *   DIVISION -> every branch under any Area in that Division
 *   AREA     -> every branch in that Area
 *   Branch   -> stays in UserBranchAssignment (shared with Manage Branches)
 *   HEAD_OFFICE row ("Head Office (all branches)" ticked) -> unrestricted, every branch
 *
 * Quality Checkers (role QC) are always scoped — even with nothing assigned —
 * so they see exactly what is ticked: their Head Office *home branch* is where
 * they sit, not coverage, and never widens them to every branch. For other
 * roles a Head Office branch assignment still means every branch, as before.
 *
 * Resolved at query time (not stored as branch ids) so a branch added later
 * under an assigned Region/Division/Area is covered automatically. The result
 * is folded into the user's assigned branches (app/lib/user-branch-assignments.ts)
 * and branch scope (app/lib/permissions/branch-scope.ts), so listings, the
 * branch switcher and every action honour it, not just approvals.
 */

export type OrgScope = {
  /** Head Office is among their assigned branches: unrestricted, every branch. */
  headOffice: boolean;
  /** Branches covered by their Region/Division/Area rows plus their assigned branches (Head Office excluded). */
  branchIds: string[];
};

// Hot path: branch scope is resolved on most API requests, so cache briefly per
// user. Invalidated in-process on save (here and in Manage Branches); other
// instances pick it up within the TTL.
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, { at: number; value: OrgScope | null }>();

export function invalidateOrgScopeCache(userId: string): void {
  cache.delete(userId);
}

/**
 * The user's org scope, or `null` when they have no Region/Division/Area
 * coverage (= no change: normal branch assignment / Head Office rules apply).
 */
export async function getOrgScope(userId: string): Promise<OrgScope | null> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const value = await loadOrgScope(userId);
  cache.set(userId, { at: Date.now(), value });
  return value;
}

/** Roles whose access is exactly their ticked coverage (never widened by a Head Office home branch). */
export const STRICT_ORG_SCOPE_ROLES = ['QC'] as const;

async function loadOrgScope(userId: string): Promise<OrgScope | null> {
  const [rows, user] = await Promise.all([
    prisma.userOrgScope.findMany({
      where: { userId },
      select: { level: true, regionId: true, divisionId: true, areaId: true },
    }),
    prisma.user.findUnique({ where: { id: userId }, select: { role: true, branchId: true } }),
  ]);
  const strict = !!user && (STRICT_ORG_SCOPE_ROLES as readonly string[]).includes(user.role);
  if (rows.length === 0 && !strict) return null;

  const regionIds = rows.filter(r => r.level === 'REGION' && r.regionId).map(r => r.regionId!);
  const divisionIds = rows.filter(r => r.level === 'DIVISION' && r.divisionId).map(r => r.divisionId!);
  const areaIds = rows.filter(r => r.level === 'AREA' && r.areaId).map(r => r.areaId!);

  const areaFilters = [
    ...(areaIds.length ? [{ id: { in: areaIds } }] : []),
    ...(divisionIds.length ? [{ divisionId: { in: divisionIds } }] : []),
    ...(regionIds.length ? [{ division: { regionId: { in: regionIds } } }] : []),
  ];

  const [areaBranches, assignments] = await Promise.all([
    areaFilters.length > 0
      ? prisma.branch.findMany({ where: { areas: { some: { OR: areaFilters } } }, select: { id: true } })
      : Promise.resolve([]),
    prisma.userBranchAssignment.findMany({ where: { userId }, select: { branchId: true } }),
  ]);

  let headOffice = rows.some(r => r.level === 'HEAD_OFFICE');
  const covered = new Set(areaBranches.map(b => b.id));
  // A strict-role user based at a real branch always covers it (even with no
  // UserBranchAssignment rows), exactly as before they became strictly scoped.
  if (strict && user?.branchId && !(await isHeadOfficeBranch(user.branchId))) covered.add(user.branchId);
  for (const a of assignments) {
    if (await isHeadOfficeBranch(a.branchId)) {
      // Strict roles: a Head Office assignment is just their home branch.
      if (!strict) headOffice = true;
    } else {
      covered.add(a.branchId);
    }
  }
  return { headOffice, branchIds: [...covered] };
}

/**
 * Branch ids the user's org scope restricts them to, or `null` when it does not
 * restrict (no scope assigned, or Head Office assigned).
 */
export async function getOrgScopeBranchIds(userId: string): Promise<string[] | null> {
  const scope = await getOrgScope(userId);
  if (!scope || scope.headOffice) return null;
  return scope.branchIds;
}

/**
 * The branch a user with a narrower-than-Head-Office org scope should start a
 * session in: their home branch when it is covered, otherwise (home is Head
 * Office, outside the coverage, or unset) the first covered branch by name —
 * so they are never parked at Head Office, which would read as "unrestricted".
 * Returns `homeBranchId` unchanged when the scope does not restrict.
 */
export async function resolveOrgScopedHomeBranchId(
  userId: string,
  homeBranchId: string | null
): Promise<string | null> {
  const covered = await getOrgScopeBranchIds(userId);
  if (covered === null || covered.length === 0) return homeBranchId;
  if (homeBranchId && covered.includes(homeBranchId)) return homeBranchId;
  const first = await prisma.branch.findFirst({
    where: { id: { in: covered }, isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true },
  });
  return first?.id ?? homeBranchId;
}

/**
 * Intersects two branch scopes where `null` means "unrestricted".
 */
export function intersectBranchScopes(a: string[] | null, b: string[] | null): string[] | null {
  if (a === null) return b;
  if (b === null) return a;
  const set = new Set(b);
  return a.filter(id => set.has(id));
}

/** Narrows `baseScope` (null = unrestricted) by `userId`'s org scope. */
export async function applyOrgScope(userId: string, baseScope: string[] | null): Promise<string[] | null> {
  return intersectBranchScopes(baseScope, await getOrgScopeBranchIds(userId));
}

/** Whether `branchId` falls inside `userId`'s org scope (true when it does not restrict). */
export async function isWithinOrgScope(userId: string, branchId: string | null): Promise<boolean> {
  const scope = await getOrgScopeBranchIds(userId);
  if (scope === null) return true;
  return !!branchId && scope.includes(branchId);
}
