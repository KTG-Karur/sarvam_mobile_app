/**
 * Server-side Route Protection Utilities
 * Provides utilities for role-based access control in server components
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyAccessToken } from './auth';
import type { UserRole } from '@/app/types';
import { ACTIVE_BRANCH_COOKIE_NAME } from '@/app/lib/branch-session';
import { prisma } from '@/app/lib/db';

/**
 * Role-based route configuration
 * Maps route patterns to required roles
 */
export const roleBasedRoutes: Record<string, UserRole[]> = {
  // Center Operations
  '/dashboard/centers': ['BRANCH_MANAGER', 'AREA_MANAGER', 'FDO', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/centers/create-center': ['BRANCH_MANAGER', 'AREA_MANAGER', 'FDO', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/centers/approve': ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/centers/transfer': ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/centers/locate': ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],

  // Client Operations
  '/dashboard/client-operations/locate-client': ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/client/enrollment': ['FDO'],
  '/dashboard/client-operations/transfer': ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'],

  // Client routes
  '/dashboard/client/client-update': ['FDO', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/client/enrollment-validation': ['ADMIN'],
  '/dashboard/client-operations/group-assign': ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/client-operations/inactive': ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/client-operations/reactive': ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],

  // Member Approval Workbench
  // FDO is included so custom RBAC roles (e.g. background-verification-team) that use
  // the FDO legacy role can reach the page. The API layer enforces QC-team-only access.
  '/dashboard/approval/workbench': ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH', 'FDO'],

  // Collections
  '/dashboard/collections/foreclosure': ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/collections/foreclosure-approval': ['AREA_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/collections/savings-refund': ['BRANCH_MANAGER', 'ADMIN'],
  '/dashboard/collections/delete-demand-collection': ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/collections/delete-client-collection': ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/collections/delete-foreclosure': ['BRANCH_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/collections/member-collection-details': ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'],

  // Revert
  '/dashboard/revert/collection-revert': ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/revert/allocation-revert': ['ADMIN'],
  '/dashboard/revert/eod-revert': ['ADMIN'],
  '/dashboard/revert/disbursement-revert': ['ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/revert/loan-closure-revert': ['ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/revert/death-revert': ['ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/revert/loan-advance-revert': ['ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'],

  // Loan Module
  '/dashboard/loan-module/application': ['FDO'],
  '/dashboard/loan-module/loan-indexation': ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/loan-module/disbursement': ['ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH', 'AREA_MANAGER', 'BRANCH_MANAGER'],
  '/dashboard/loan-module/change-funder': ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/loan-module/delete-disbursement': ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/loan-module/final-disbursement': ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/loan-module/member-individual': ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'],

  // Payroll & Attendance
  '/dashboard/hr/leave-type': ['AREA_MANAGER'],
  '/dashboard/hr/permission-type': ['AREA_MANAGER'],
  '/dashboard/hr/working-hours': ['ADMIN', 'AREA_MANAGER'],
  '/dashboard/hr/attendance/week-configuration': ['ADMIN', 'AREA_MANAGER'],
  '/dashboard/hr/attendance/holiday-calendar': ['ADMIN', 'AREA_MANAGER'],
  '/dashboard/hr/shift-management': ['ADMIN', 'AREA_MANAGER'],
  '/dashboard/hr/punch-radius': ['ADMIN', 'AREA_MANAGER'],
  '/dashboard/hr/leave-balance': ['AREA_MANAGER'],
  '/dashboard/hr/attendance': ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/hr/salary': ['AREA_MANAGER'],
  '/dashboard/hr/salary-master': ['AREA_MANAGER'],
  // Salary Pay removed — its submit/approve/pay operation lives on the
  // Payroll page now (see components/hr/payroll/PayrollClient.tsx).
  '/dashboard/hr/payroll': ['AREA_MANAGER', 'ADMIN'],

  // Employees
  '/dashboard/employees/management': ['ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH', 'BRANCH_MANAGER'],
  '/dashboard/employees/reset-password': ['ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH', 'BRANCH_MANAGER', 'AREA_MANAGER', 'FDO'],

  // Reports
  '/dashboard/admin-reports': ['ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH', 'AREA_MANAGER', 'BRANCH_MANAGER'],
  '/dashboard/mis-reports': ['ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH', 'AREA_MANAGER'],

  // Transactions - HO specific (AM also allowed; date enforced server-side)
  // Temporarily disabled/hidden until client confirmation.
  '/dashboard/transactions/ho-transaction': [],

  // EOD
  '/dashboard/eod/eod-process': ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/eod/eod-approval': ['AREA_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'],

  // Utilities
  '/dashboard/utilities/set-gl-balance': ['ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH', 'AREA_MANAGER', 'BRANCH_MANAGER'],
  '/dashboard/utilities/denomination-entry': ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],

  // Reports - Collection
  '/dashboard/reports/collection/mcr': ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/reports/collection/dcr': ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/reports/collection/dcb': ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/reports/collection/ccr': ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/reports/collection/meeting-check': ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/reports/collection/receipts': ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/reports/collection/loan-savings': ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/reports/collection': ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],

  // Reports - Employee
  '/dashboard/reports/employee/payslip': ['AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],

  // Reports - Client
  '/dashboard/reports/client/loan-schedule': ['BRANCH_MANAGER', 'FDO', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/reports/client/loan-ledger': ['BRANCH_MANAGER', 'FDO', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/reports/client/addition-deletion': ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/reports/client/addition-disbursed': ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/reports/client/dropouts': ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/reports/client/meeting-attendance': ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/reports/client/transfer': ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/reports/client/double-clients': ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/reports/client/waiting-borrowers': ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/reports/client/loan-advance': ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/reports/client/application-form': ['BRANCH_MANAGER', 'FDO', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/reports/client/balance-information': ['BRANCH_MANAGER', 'FDO', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],

  // Reports - Others
  '/dashboard/reports/others/branch-profile': ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/reports/others/center-master': ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/reports/others/insurance': ['AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/reports/others/loan-index': ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/reports/others/pending-items': ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/reports/others/neft-format': ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],

  // Reports - Demand
  '/dashboard/reports/demand/demand-sheet': ['BRANCH_MANAGER', 'FDO', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/reports/demand/arrear-demand-sheet': ['BRANCH_MANAGER', 'FDO', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/reports/demand/future-demand': ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/reports/demand/branch-demand': ['BRANCH_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],

  // Reports - Employee
  '/dashboard/reports/employee': ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH', 'ADMIN'],
  '/dashboard/reports/employee/attendance-detailed': ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/reports/employee/attendance-summary': ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/reports/employee/fdo-performance': ['BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/reports/employee/task-report': ['ADMIN'],

  // Reports - Portfolio
  '/dashboard/reports/portfolio/individual-ledger': ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'],
  '/dashboard/reports/portfolio/loan-disbursement': ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'],
  '/dashboard/reports/portfolio/loan-advance-refund': ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'],
  '/dashboard/reports/portfolio/os-centerwise': ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'],
  '/dashboard/reports/portfolio/par': ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'],
  '/dashboard/reports/portfolio/preclosure': ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'],

  // Admin-Reports - Portfolio
  '/dashboard/admin-reports/portfolio/os-branchwise': ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'],
  '/dashboard/admin-reports/portfolio/os-clientwise': ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'],
  '/dashboard/admin-reports/portfolio/clientwise-dcb': ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'],
  '/dashboard/admin-reports/portfolio/agewise-arrear': ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'],
  '/dashboard/admin-reports/portfolio/center-master-report': ['ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH', 'BRANCH_MANAGER', 'AREA_MANAGER'],

  // Admin-Reports - Account
  '/dashboard/admin-reports/account/daybook': ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'],
  '/dashboard/admin-reports/account/gl-one': ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'],
  '/dashboard/admin-reports/account/gl-all': ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'],
  '/dashboard/admin-reports/account/receipts-payments': ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'],
  '/dashboard/admin-reports/account/trial-balance': ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'],
  '/dashboard/admin-reports/account/profit-loss': ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'],
  '/dashboard/admin-reports/account/balance-sheet': ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'],
  '/dashboard/admin-reports/account/voucher-print': ['ADMIN', 'BRANCH_MANAGER'],
  '/dashboard/admin-reports/account/compare-ilgl': ['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'],

  // Admin-Reports - Funders
  '/dashboard/admin-reports/funders/funder-report': ['ADMIN'],
  '/dashboard/admin-reports/funders/funder-interest': ['ADMIN'],

  // Reports - Gold
  '/dashboard/reports/gold': ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],

  // Admin Reports - Others
  '/dashboard/admin-reports/others/highmark-update': ['ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH', 'BRANCH_MANAGER'],
  '/dashboard/admin-reports/others/sms-format': ['ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH', 'BRANCH_MANAGER'],
  // UCRF/CDF credit-bureau export — ADMIN only (longest prefix overrides '/dashboard/admin-reports').
  // protectAdminOnlyServerRoute() additionally blocks the RBAC page-permission override.
  '/dashboard/admin-reports/others/ucrf-export': ['ADMIN'],

  // Client Search
  '/dashboard/client-search': ['ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH', 'BRANCH_MANAGER', 'FDO', 'AREA_MANAGER'],

  // Branch Operations
  '/dashboard/branch/create': ['ADMIN'],
  '/dashboard/branch/change': ['ADMIN', 'AREA_MANAGER', 'ADMIN_NON_HO_BRANCH_SWITCH'],
  '/dashboard/branch/product-map': ['ADMIN'],
  '/dashboard/branch/working-date': ['ADMIN'],

  // Masters - Economic Activity Type and Economic Activity
  '/dashboard/masters/economic-activity-type': ['ADMIN'],
  '/dashboard/masters/economic-activity': ['ADMIN'],

  // Masters - Meeting Place
  '/dashboard/masters/meeting-place': ['ADMIN'],

  // Masters - Questionnaire
  '/dashboard/masters/questionnaire': ['ADMIN'],

  // Masters - upload (Loan upload: historical loan + repayment import for existing clients)
  '/dashboard/masters/uploan/loan': ['ADMIN'],

  // Masters - upload (Loan History Edit: edit an already-migrated loan's Loan Card + Repayment, then rebuild)
  '/dashboard/masters/uploan/loan-history': ['ADMIN'],

  // Masters - Super Control (Individual Funder Change: live-loan funder change + GL re-home)
  '/dashboard/masters/super-control/individual-funder-change': ['ADMIN'],

  // Masters - Super Control (Bulk Funder Change: branch-wise funder transfer + GL re-home)
  '/dashboard/masters/super-control/bulk-funder-change': ['ADMIN'],

  // Masters - Super Control (Live Loan Schedule Edit: in-place Loan Card edit of live loans)
  '/dashboard/masters/super-control/loan-schedule-edit': ['ADMIN'],

  // Masters - Super Control (Member ID Edit: change Client.clientId)
  '/dashboard/masters/super-control/member-id-edit': ['ADMIN'],

  // Masters - Super Control (Audit History: who changed what, when)
  '/dashboard/masters/super-control/audit-history': ['ADMIN'],

  // Masters - upload (Loan Advance Edit: correct Client.loanAdvance per member, branch-wise)
  '/dashboard/masters/uploan/loan-advance': ['ADMIN'],

  // Masters - upload (Member upload bulk import)
  '/dashboard/masters/uploan/member': ['ADMIN'],

  // Masters - upload (Closed loan member upload — unreturned savings/gold bulk import)
  '/dashboard/masters/uploan/closed-member': ['ADMIN'],

  // Masters - upload (Import History + same-day revert)
  '/dashboard/masters/uploan/history': ['ADMIN'],

  // Masters - FDO Task Management
  '/dashboard/hr/performance/tasks': ['ADMIN'],
};

type ServerAuthContext =
  | { kind: 'unauthenticated' }
  | { kind: 'authenticated'; userId: string; role: UserRole; branchId?: string };

/**
 * Get user role from JWT token in cookies (server-side)
 * @returns User role or null if not authenticated
 */
export async function getServerUserRole(): Promise<UserRole | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('accessToken')?.value;

    if (!token) {
      return null;
    }

    try {
      const payload = verifyAccessToken(token);
      return (payload.role as UserRole) || null;
    } catch {
      // Token is invalid or expired
      return null;
    }
  } catch {
    // Cookies API not available or other error
    // In development, this might happen - return null to allow access
    // In production, this should be handled properly
    return null;
  }
}

async function getServerAuthContext(): Promise<ServerAuthContext> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('accessToken')?.value;

    if (!token) return { kind: 'unauthenticated' };

    const payload = verifyAccessToken(token) as unknown as {
      userId?: string;
      role?: string;
      branchId?: string;
    };

    const role = (payload.role as UserRole) || null;
    const userId = payload.userId || null;
    if (!role || !userId) return { kind: 'unauthenticated' };

    let branchId = payload.branchId;
    const activeBranchCookie = cookieStore.get(ACTIVE_BRANCH_COOKIE_NAME)?.value;
    if (
      (role === 'ADMIN' || role === 'AREA_MANAGER') &&
      activeBranchCookie
    ) {
      branchId = activeBranchCookie;
    }

    return { kind: 'authenticated', userId, role, branchId };
  } catch {
    return { kind: 'unauthenticated' };
  }
}

/**
 * Check if the user's active RBAC roles grant view access to a page.
 * This is the override check used when the legacy roleBasedRoutes check fails.
 * If an Admin has explicitly granted a page to a role via the permissions panel,
 * users with that role bypass the static roleBasedRoutes restriction.
 */
async function hasRbacPagePermission(userId: string, pathname: string): Promise<boolean> {
  try {
    const userRoles = await prisma.userRoleAssignment.findMany({
      where: { userId, isActive: true },
      include: {
        role: {
          select: { isActive: true, pagePermissions: true },
        },
      },
    });

    for (const assignment of userRoles) {
      if (!assignment.role.isActive) continue;
      const perms = assignment.role.pagePermissions as Record<string, Record<string, boolean>> | null;
      if (!perms) continue;
      // Check for exact path or any parent path (longest-prefix wins already handled by caller)
      if (perms[pathname]?.view === true) return true;
    }

    return false;
  } catch {
    // Non-fatal — if DB is unavailable, fall back to denying access
    return false;
  }
}

/**
 * Check if a user has access to a route based on their role (server-side)
 * @param pathname The pathname to check
 * @param userRole The user's role
 * @returns true if user has access, false otherwise
 */
export function hasServerRouteAccess(
  pathname: string,
  userRole: UserRole | null
): boolean {
  if (!userRole) {
    return false;
  }

  // Find the most specific matching restriction (longest prefix).
  // This avoids `/a/b` shadowing `/a/b-c` when using startsWith.
  const restriction = Object.entries(roleBasedRoutes)
    .filter(([pattern]) => pathname.startsWith(pattern))
    .sort(([a], [b]) => b.length - a.length)[0];

  if (!restriction) {
    // No restriction means accessible to all authenticated users
    return true;
  }

  const [, allowedRoles] = restriction;
  return allowedRoles.includes(userRole);
}

/**
 * Pure route-role decision, split out so it can be unit tested without a
 * database. Admin always keeps unrestricted access — there is no branch-based
 * downgrade, so `effectiveRole` and `rawRole` are the same value in practice.
 */
export function evaluateServerRouteAccess(
  pathname: string,
  effectiveRole: UserRole,
  rawRole: UserRole
): boolean {
  // Admin — unrestricted access to every page, always, regardless of branch.
  if (effectiveRole === 'ADMIN' || rawRole === 'ADMIN') return true;

  // Find the most specific matching restriction (longest prefix).
  const restriction = Object.entries(roleBasedRoutes)
    .filter(([pattern]) => pathname.startsWith(pattern))
    .sort(([a], [b]) => b.length - a.length)[0];

  if (!restriction) return true;

  const [, allowedRoles] = restriction;

  return allowedRoles.includes(effectiveRole);
}

async function hasServerRouteAccessWithBranchContext(
  pathname: string,
  auth: ServerAuthContext
): Promise<boolean> {
  if (auth.kind !== 'authenticated') return false;

  return evaluateServerRouteAccess(pathname, auth.role, auth.role);
}

/**
 * Strict variant for pages that must be reachable by the literal `ADMIN` role only. Unlike
 * {@link protectServerRoute} it does NOT fall back to RBAC page permissions, so a custom role
 * that an admin granted the page to still cannot open it.
 */
export async function protectAdminOnlyServerRoute(): Promise<void> {
  const auth = await getServerAuthContext();
  if (auth.kind !== 'authenticated' || auth.role !== 'ADMIN') {
    redirect('/dashboard?error=insufficient_permissions');
  }
}

/**
 * Server-side function to protect a route based on user role
 * Redirects to dashboard if user doesn't have access
 * 
 * Note: In development mode with authentication disabled, this will allow access.
 * In production, ensure authentication middleware is enabled.
 * 
 * @param pathname The pathname to check
 */
export async function protectServerRoute(pathname: string): Promise<void> {
  const auth = await getServerAuthContext();

  if (auth.kind !== 'authenticated') {
    redirect('/dashboard?error=insufficient_permissions');
  }

  // Step 1: Check the legacy role-based route table (fast, no DB)
  const roleAllowed = await hasServerRouteAccessWithBranchContext(pathname, auth);
  if (roleAllowed) return; // Access granted — done

  // Step 2: Legacy check failed — try RBAC page permissions as override.
  // If an Admin has explicitly granted this page to the user's RBAC role,
  // we allow through regardless of the static roleBasedRoutes list.
  const rbacAllowed = await hasRbacPagePermission(auth.userId, pathname);

  // Step 3: a user holding an active Sub Admin RBAC role (Role.isSubAdmin) gets the same page
  // access as Admin. protectAdminOnlyServerRoute (literal ADMIN) does not go through here.
  let subAdminAllowed = false;
  if (!rbacAllowed) {
    try {
      const { isSubAdminUser } = await import('@/app/lib/permissions/sub-admin');
      subAdminAllowed = await isSubAdminUser(auth.userId);
    } catch {
      subAdminAllowed = false; // fail closed
    }
  }
  if (!rbacAllowed && !subAdminAllowed) {
    redirect('/dashboard?error=insufficient_permissions');
  }
  // rbacAllowed === true → fall through, access granted
}
