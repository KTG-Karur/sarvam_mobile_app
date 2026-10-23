// ============================================================
// PERMISSION GUARDS — Reusable API route protection functions
// app/lib/permissions/guards.ts
//
// Usage in any API route:
//   const ctx = await requirePermission(request, 'loan', 'approve');
//   // ctx is UserContext — use for branch filtering, etc.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { verifyAccessToken } from '@/app/lib/auth/jwt';
import { prisma } from '@/app/lib/db';
import { loadUserContext, checkPermission } from './engine';
import type { UserContext, PermissionCheckRequest } from './types';
import { getOrgScope } from './org-scope';

// ─────────────────────────────────────────────
// GET USER CONTEXT FROM REQUEST
// Extracts JWT, verifies it, loads permissions
// ─────────────────────────────────────────────
export async function getUserContext(
  request: NextRequest
): Promise<UserContext | null> {
  try {
    const token =
      request.cookies.get('accessToken')?.value ||
      request.headers.get('Authorization')?.replace('Bearer ', '');

    if (!token) return null;

    const payload = verifyAccessToken(token);
    if (!payload) return null;

    const context = await loadUserContext(
      payload.userId,
      payload.branchId,
      payload.permVersion
    );

    return context;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
// REQUIRE AUTHENTICATION
// Returns UserContext or 401 response
// ─────────────────────────────────────────────
export async function requireAuth(
  request: NextRequest
): Promise<UserContext | NextResponse> {
  const context = await getUserContext(request);
  if (!context) {
    return NextResponse.json(
      { success: false, error: 'Authentication required' },
      { status: 401 }
    );
  }
  return context;
}

// ─────────────────────────────────────────────
// REQUIRE PERMISSION
// Returns UserContext or 403 response
// ─────────────────────────────────────────────
export async function requirePermission(
  request: NextRequest,
  moduleSlug: string,
  actionSlug: string,
  abacContext?: Partial<PermissionCheckRequest>
): Promise<UserContext | NextResponse> {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const ctx = authResult as UserContext;
  const result = checkPermission(ctx, {
    moduleSlug,
    actionSlug,
    ...abacContext,
  });

  if (!result.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: 'Permission denied',
        detail: result.reason,
      },
      { status: 403 }
    );
  }

  return ctx;
}

// ─────────────────────────────────────────────
// REQUIRE ANY PERMISSION
// User must have AT LEAST ONE of the listed permissions
// ─────────────────────────────────────────────
export async function requireAnyPermission(
  request: NextRequest,
  checks: Array<{ module: string; action: string }>
): Promise<UserContext | NextResponse> {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const ctx = authResult as UserContext;

  const hasAny = checks.some((c) =>
    checkPermission(ctx, { moduleSlug: c.module, actionSlug: c.action }).allowed
  );

  if (!hasAny) {
    return NextResponse.json(
      { success: false, error: 'Insufficient permissions' },
      { status: 403 }
    );
  }

  return ctx;
}

// ─────────────────────────────────────────────
// REQUIRE ALL PERMISSIONS
// User must have ALL listed permissions
// ─────────────────────────────────────────────
export async function requireAllPermissions(
  request: NextRequest,
  checks: Array<{ module: string; action: string }>
): Promise<UserContext | NextResponse> {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const ctx = authResult as UserContext;

  for (const c of checks) {
    const result = checkPermission(ctx, { moduleSlug: c.module, actionSlug: c.action });
    if (!result.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: 'Insufficient permissions',
          detail: `Missing: ${c.module}:${c.action}`,
        },
        { status: 403 }
      );
    }
  }

  return ctx;
}

// ─────────────────────────────────────────────
// REQUIRE BRANCH ACCESS
// Ensures user can operate on the given branch
// ─────────────────────────────────────────────
export async function requireBranchAccess(
  request: NextRequest,
  targetBranchId: string,
  minAccessType: 'FULL' | 'OPERATIONAL' | 'READONLY' | 'REPORTING' = 'OPERATIONAL'
): Promise<UserContext | NextResponse> {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const ctx = authResult as UserContext;
  const ACCESS_HIERARCHY = ['REPORTING', 'READONLY', 'OPERATIONAL', 'FULL'];

  // Current branch is always accessible
  if (targetBranchId === ctx.branchId) return ctx;

  // Check explicit branch access
  const branchAccess = ctx.branchAccess.find((ba) => ba.branchId === targetBranchId);
  if (!branchAccess) {
    return NextResponse.json(
      { success: false, error: 'No access to this branch' },
      { status: 403 }
    );
  }

  // Check access level
  const userLevel = ACCESS_HIERARCHY.indexOf(branchAccess.accessType);
  const requiredLevel = ACCESS_HIERARCHY.indexOf(minAccessType);

  if (userLevel < requiredLevel) {
    return NextResponse.json(
      {
        success: false,
        error: `Insufficient branch access. Required: ${minAccessType}, Current: ${branchAccess.accessType}`,
      },
      { status: 403 }
    );
  }

  return ctx;
}

// ─────────────────────────────────────────────
// REQUIRE HEAD OFFICE
// Only allows requests from HO branch context
// ─────────────────────────────────────────────
export async function requireHeadOffice(
  request: NextRequest
): Promise<UserContext | NextResponse> {
  const authResult = await requireAuth(request);
  if (authResult instanceof NextResponse) return authResult;

  const ctx = authResult as UserContext;

  if (!ctx.isHeadOffice) {
    return NextResponse.json(
      { success: false, error: 'This operation requires Head Office access' },
      { status: 403 }
    );
  }

  return ctx;
}

// ─────────────────────────────────────────────
// HAS ROLE — Check if user has a specific role slug
// ─────────────────────────────────────────────
export function hasRole(ctx: UserContext, roleSlug: string): boolean {
  return ctx.roles.some((r) => r.roleSlug === roleSlug);
}

// ─────────────────────────────────────────────
// HAS ANY ROLE — Check if user has any of the listed roles
// ─────────────────────────────────────────────
export function hasAnyRole(ctx: UserContext, roleSlugs: string[]): boolean {
  return ctx.roles.some((r) => roleSlugs.includes(r.roleSlug));
}

// ─────────────────────────────────────────────
// TYPE GUARD — Check if result is UserContext
// ─────────────────────────────────────────────
export function isUserContext(result: UserContext | NextResponse): result is UserContext {
  return !(result instanceof NextResponse);
}

// ─────────────────────────────────────────────
// EMPLOYEE BRANCH SCOPE — is this employee's branch one the
// caller is permitted to operate on? HO-based callers and admins
// (system-wide, same as canActorApplyForEmployee / checkPermission)
// see everyone — an org-wide admin such as the CEO has no branch of
// their own, so without this they could open no one's HR record.
//
// `employeeExtraBranchIds`: branches the employee belongs to beyond
// User.branchId — an Area Manager's branchId is null by design and
// their branches live in AreaManagerBranch (getEmployeeAreaBranchIds).
// ─────────────────────────────────────────────
export function isEmployeeBranchPermitted(
  ctx: UserContext,
  employeeBranchId: string | null,
  employeeExtraBranchIds: readonly string[] = []
): boolean {
  if (ctx.isHeadOffice) return true;
  if (ctx.roles.some((r) => r.roleSlug === 'admin')) return true;
  const permittedBranchIds = new Set(ctx.branchAccess.map((ba) => ba.branchId));
  return [employeeBranchId, ...employeeExtraBranchIds].some((id) => !!id && permittedBranchIds.has(id));
}

/**
 * isEmployeeBranchPermitted, plus the caller's org scope (Region / Division /
 * Area coverage and Head Office assigned in Manage Branches — org-scope.ts).
 * The Employee List is scoped through getPermittedBranchIds, which honours org
 * scope; opening one of those employees must honour it too, or a user could see
 * someone in the list and then be refused their record.
 */
export async function isEmployeeInCallerScope(
  ctx: UserContext,
  employeeBranchId: string | null,
  employeeExtraBranchIds: readonly string[] = []
): Promise<boolean> {
  if (isEmployeeBranchPermitted(ctx, employeeBranchId, employeeExtraBranchIds)) return true;
  const orgScope = await getOrgScope(ctx.userId);
  if (!orgScope) return false;
  if (orgScope.headOffice) return true;
  const covered = new Set(orgScope.branchIds);
  return [employeeBranchId, ...employeeExtraBranchIds].some((id) => !!id && covered.has(id));
}

/** An Area Manager's assigned branches (empty for anyone with a User.branchId or no AM rows). */
export async function getEmployeeAreaBranchIds(employeeId: string, employeeBranchId: string | null): Promise<string[]> {
  if (employeeBranchId) return [];
  const rows = await prisma.areaManagerBranch.findMany({ where: { userId: employeeId }, select: { branchId: true } });
  return rows.map((r) => r.branchId);
}

// ─────────────────────────────────────────────
// REQUIRE ACCESS TO ANOTHER EMPLOYEE'S HR RECORD
// A caller may always act on their own record (targetEmployeeId === ctx.userId
// is the caller's job to check before calling this). Reaching into someone
// else's HR data (leave, goals, reviews, documents, belongings, approvals)
// requires both the `hr-employee:view` grant and that the target employee's
// branch is one the caller is permitted to operate on — otherwise any
// authenticated user could read/act on another employee's records just by
// editing a query param or record id.
// ─────────────────────────────────────────────
export async function requireEmployeeAccess(
  request: NextRequest,
  targetEmployeeId: string
): Promise<UserContext | NextResponse> {
  const ctx = await requirePermission(request, 'hr-employee', 'view');
  if (!isUserContext(ctx)) return ctx;

  const employee = await prisma.user.findUnique({ where: { id: targetEmployeeId }, select: { branchId: true } });
  if (!employee) {
    return NextResponse.json({ success: false, error: 'Employee not found' }, { status: 404 });
  }
  const areaBranchIds = await getEmployeeAreaBranchIds(targetEmployeeId, employee.branchId);
  if (!(await isEmployeeInCallerScope(ctx, employee.branchId, areaBranchIds))) {
    return NextResponse.json(
      { success: false, error: 'You do not have access to this employee' },
      { status: 403 }
    );
  }
  return ctx;
}

// ─────────────────────────────────────────────
// REQUIRE ACCESS TO APPLY LEAVE / PERMISSION ON BEHALF OF AN EMPLOYEE
// Checks role pagePermissions dynamically from the Role Permissions Editor.
// No hardcoded roles or permissions.
// ─────────────────────────────────────────────
export async function canActorApplyForEmployee(
  request: NextRequest,
  targetEmployeeId: string,
  pageHref: '/dashboard/hr/leave/apply' | '/dashboard/hr/permission/apply'
): Promise<UserContext | NextResponse> {
  const authResult = await requireAuth(request);
  if (!isUserContext(authResult)) return authResult;
  const ctx = authResult;

  // Caller applying for themselves is always authorized
  if (targetEmployeeId === ctx.userId) return ctx;

  const isAdmin = ctx.roles.some((r) => r.roleSlug === 'admin') || ctx.isHeadOffice;

  let hasPagePermission = false;
  if (isAdmin) {
    hasPagePermission = true;
  } else {
    // Dynamic lookup: check if any of the user's active roles grant 'edit' on the apply page
    // or 'approve' on the corresponding approval page in role.pagePermissions
    const approvalHref =
      pageHref === '/dashboard/hr/leave/apply'
        ? '/dashboard/hr/leave/approval'
        : '/dashboard/hr/permission/approval';

    const roleIds = ctx.roles.map((r) => r.roleId);
    const roles = await prisma.role.findMany({
      where: { id: { in: roleIds }, isActive: true },
      select: { pagePermissions: true },
    });

    for (const r of roles) {
      const perms = r.pagePermissions as Record<string, Record<string, boolean>> | null;
      if (!perms) continue;
      if (perms[pageHref]?.edit === true || perms[approvalHref]?.approve === true) {
        hasPagePermission = true;
        break;
      }
    }
  }

  if (!hasPagePermission) {
    return NextResponse.json(
      { success: false, error: 'You do not have permission to apply on behalf of other employees' },
      { status: 403 }
    );
  }

  const employee = await prisma.user.findUnique({ where: { id: targetEmployeeId }, select: { branchId: true } });
  if (!employee) {
    return NextResponse.json({ success: false, error: 'Employee not found' }, { status: 404 });
  }

  const areaBranchIds = await getEmployeeAreaBranchIds(targetEmployeeId, employee.branchId);
  if (!(await isEmployeeInCallerScope(ctx, employee.branchId, areaBranchIds))) {
    return NextResponse.json(
      { success: false, error: 'You do not have access to this employee' },
      { status: 403 }
    );
  }

  return ctx;
}

