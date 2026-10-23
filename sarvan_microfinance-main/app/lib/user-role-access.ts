import type { JWTPayload } from '@/app/lib/auth';

/**
 * Branch for data scoping: active context from JWT (cookie/header merged in getAuthenticatedUser)
 * falls back to the user's row in DB.
 */
export function resolveOperationalBranchId(
  user: JWTPayload,
  dbBranchId: string | null | undefined
): string | null {
  return user.branchId ?? dbBranchId ?? null;
}

/**
 * Pure role-matching decision, split out from {@link userMatchesAllowedApiRoles}
 * so it can be unit tested without touching the database.
 *
 * ADMIN always matches — unrestricted API access, regardless of branch.
 * Otherwise: direct role match.
 */
export function evaluateApiRoleAccess(params: {
  userRole: string;
  allowedRoles: readonly string[];
}): boolean {
  const { userRole, allowedRoles } = params;

  if (userRole === 'ADMIN') return true;

  return allowedRoles.includes(userRole);
}

export async function userMatchesAllowedApiRoles(
  user: JWTPayload,
  allowedRoles: readonly string[]
): Promise<boolean> {
  if (
    evaluateApiRoleAccess({
      userRole: user.role,
      allowedRoles,
    })
  ) {
    return true;
  }

  // A user holding an active Sub Admin RBAC role (Role.isSubAdmin) gets the same API access
  // as Admin. Only looked up when the base-role check fails, so normal requests pay nothing.
  // Routes with their own literal-ADMIN guard (e.g. UCRF export) re-check the role and stay closed.
  if (!user.userId) return false;
  try {
    const { isSubAdminUser } = await import('@/app/lib/permissions/sub-admin');
    return await isSubAdminUser(user.userId);
  } catch {
    return false; // fail closed if the lookup is unavailable
  }
}
