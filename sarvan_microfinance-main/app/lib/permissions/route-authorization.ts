// ============================================================
// PAGE AUTHORIZATION — Pure decision helpers shared by
// ProtectedRoute (client) and AppSidebar (client).
// app/lib/permissions/route-authorization.ts
//
// Kept dependency-free (no React/DOM/Prisma) so the access
// decisions can be unit tested directly.
// ============================================================

import { hasPermission, PERMISSIONS } from '@/app/lib/permissions';
import type { UserRole } from '@/app/types';
import type { PagePermissionsMap } from '@/app/store/authStore';

export interface BranchInfoLike {
  code?: string | null;
  name?: string | null;
}

/**
 * True when the given branch is Head Office (code 'HO' or name 'head office').
 * Mirrors app/lib/head-office-branch.ts's server-side definition.
 */
export function isHeadOfficeBranchInfo(branch: BranchInfoLike | null | undefined): boolean {
  if (!branch) return false;
  const code = (branch.code ?? '').toUpperCase();
  const name = (branch.name ?? '').toLowerCase();
  return code === 'HO' || name === 'head office';
}

/**
 * ADMIN always keeps unrestricted access, regardless of which branch is
 * currently active — there is no branch-based downgrade. `branch` is accepted
 * for call-site compatibility but no longer affects the result.
 */
export function computeEffectiveRole(
  jwtRole: UserRole,
  _branch: BranchInfoLike | null | undefined
): UserRole {
  return jwtRole;
}

export type PageAuthDecision = 'allow' | 'deny' | 'pending';

export interface ResolvePageAuthorizationParams {
  userRole: UserRole;
  effectiveRole: UserRole;
  pathname: string;
  requiredPermission?: keyof typeof PERMISSIONS;
  requiredRoles?: UserRole[];
  /** Merged RBAC page-permissions for the user's role(s); null = not loaded/configured yet. */
  pagePermissions: PagePermissionsMap | null;
  /** True once the RBAC permissions fetch (/api/auth/permissions) has settled at least once. */
  permissionsHydrated: boolean;
}

/**
 * Decides whether a user may view a client-routed dashboard page.
 *
 * Order of evaluation:
 *  1. Admin always gets in — no further checks, regardless of branch.
 *  2. Legacy static requiredPermission/requiredRoles — fast path, no RBAC
 *     round-trip needed (covers the vast majority of navigations).
 *  3. RBAC page-permission grant (Admin-configured via the Role Permissions
 *     panel) can override a legacy deny. Because that grant loads
 *     asynchronously, an undecided/stale RBAC state returns 'pending'
 *     instead of 'deny' so the caller can wait rather than bounce the user.
 */
export function resolvePageAuthorization(
  params: ResolvePageAuthorizationParams
): PageAuthDecision {
  const {
    userRole,
    effectiveRole,
    pathname,
    requiredPermission,
    requiredRoles,
    pagePermissions,
    permissionsHydrated,
  } = params;

  // Admin — unrestricted access to every page, always, regardless of branch.
  if (effectiveRole === 'ADMIN' || userRole === 'ADMIN') return 'allow';

  const hasPermissionRequirement = !!requiredPermission;
  const hasRoleRequirement = !!(requiredRoles && requiredRoles.length > 0);

  // No restriction configured on this route at all.
  if (!hasPermissionRequirement && !hasRoleRequirement) return 'allow';

  const legacyPermissionAllows =
    !hasPermissionRequirement ||
    hasPermission(effectiveRole, requiredPermission!) ||
    (effectiveRole !== userRole && hasPermission(userRole, requiredPermission!));

  const legacyRoleAllows =
    !hasRoleRequirement ||
    requiredRoles!.includes(effectiveRole) ||
    requiredRoles!.includes(userRole);

  if (legacyPermissionAllows && legacyRoleAllows) return 'allow';

  // Legacy static checks failed — defer to the RBAC page-permission grant,
  // which lets an Admin explicitly open this page for the user's role via
  // the Role Permissions panel, overriding the legacy allow-list.
  if (pagePermissions !== null && pagePermissions[pathname]?.view === true) {
    return 'allow';
  }

  // Nothing granted this page. Only treat that as final once the RBAC fetch
  // has actually settled — otherwise we might be looking at a stale/absent
  // cache and would wrongly bounce a user who was just granted access.
  return permissionsHydrated ? 'deny' : 'pending';
}
