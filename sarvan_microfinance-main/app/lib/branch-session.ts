import type { UserRole } from '@/app/types';

/** HttpOnly cookie: active branch for ADMIN / AREA_MANAGER (page loads + APIs). */
export const ACTIVE_BRANCH_COOKIE_NAME = 'activeBranchId';

const ACTIVE_BRANCH_COOKIE_MAX_AGE_SEC = 7 * 24 * 60 * 60;

export function getActiveBranchCookieOptions(): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'lax';
  path: string;
  maxAge: number;
} {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: ACTIVE_BRANCH_COOKIE_MAX_AGE_SEC,
  };
}

/**
 * Edge middleware: ADMIN is not listed on many operational routes (BM/AM/ADMIN_NON_HO only).
 * Server Components use {@link ACTIVE_BRANCH_COOKIE_NAME} + JWT to apply HO/non-HO rules.
 */
export function shouldDeferAdminDashboardRoleCheckToServer(
  allowedRoles: readonly UserRole[]
): boolean {
  if (allowedRoles.includes('ADMIN')) {
    return false;
  }
  return (
    allowedRoles.includes('ADMIN_NON_HO_BRANCH_SWITCH') ||
    allowedRoles.includes('BRANCH_MANAGER') ||
    allowedRoles.includes('AREA_MANAGER')
  );
}
