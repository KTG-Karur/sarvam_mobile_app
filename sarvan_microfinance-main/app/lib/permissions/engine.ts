// ============================================================
// PERMISSION ENGINE — Core permission resolution logic
// app/lib/permissions/engine.ts
// ============================================================

import { prisma } from '@/app/lib/prisma';
import { permissionCache } from './cache';
import type {
  UserContext,
  PermissionSet,
  PermissionCheckRequest,
  PermissionCheckResult,
  UserRoleSummary,
  BranchAccessSummary,
  FieldPermissionMap,
  ReportPermissionMap,
  ReportAccessResult,
  PermissionConditions,
} from './types';

// ─────────────────────────────────────────────
// LOAD USER CONTEXT — cache-first
// ─────────────────────────────────────────────
export async function loadUserContext(
  userId: string,
  branchId: string | null,
  permVersion: number
): Promise<UserContext | null> {
  // 1. Check cache
  const cached = await permissionCache.getWithVersion(userId);
  if (cached && cached.version === permVersion) {
    return { ...cached.context, branchId };
  }

  // 2. Load from DB
  const context = await buildUserContextFromDB(userId, branchId);
  if (!context) return null;

  // 3. Store in cache
  await permissionCache.set(userId, context, permVersion);
  return context;
}

// ─────────────────────────────────────────────
// BUILD USER CONTEXT FROM DATABASE
// Uses userRoleAssignment (the Prisma model name for user→role junction)
// ─────────────────────────────────────────────
async function buildUserContextFromDB(
  userId: string,
  branchId: string | null
): Promise<UserContext | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId, isActive: true },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      isActive: true,
      branchId: true,

      // RBAC: user's dynamic roles (UserRoleAssignment model → field name is userRoles on User)
      userRoles: {
        where: { isActive: true },
        select: {
          branchId: true,
          role: {
            select: {
              id: true,
              name: true,
              slug: true,
              priority: true,
              isActive: true,
              permissions: {
                where: { isActive: true },
                select: {
                  effect: true,
                  conditions: true,
                  permission: {
                    select: {
                      id: true,
                      name: true,
                      module: { select: { slug: true } },
                      action: { select: { slug: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },

      // Multi-branch access
      userBranchAccess: {
        where: { isActive: true },
        select: {
          branchId: true,
          accessType: true,
          isPrimary: true,
          branch: {
            select: { id: true, name: true, code: true },
          },
        },
      },
    },
  });

  if (!user) return null;

  // Roles summary
  const roles: UserRoleSummary[] = user.userRoles
    .filter((ur) => ur.role.isActive)
    .map((ur) => ({
      roleId: ur.role.id,
      roleName: ur.role.name,
      roleSlug: ur.role.slug,
      priority: ur.role.priority,
      branchId: ur.branchId,
    }));

  const roleIds = roles.map((r) => r.roleId);

  // Build flat permission set from all roles
  const permissionSet = buildPermissionSetFromRoles(user.userRoles, branchId);

  // Branch access
  const branchAccess: BranchAccessSummary[] = await buildBranchAccess(
    user.userBranchAccess,
    user.id
  );

  const isHeadOffice = await checkIsHeadOffice(branchId);

  // Field + report permissions (loaded per role)
  const fieldPermissions = await loadFieldPermissions(roleIds);
  const reportPermissions = await loadReportPermissions(roleIds);

  return {
    userId: user.id,
    email: user.email ?? '',
    firstName: user.firstName,
    lastName: user.lastName,
    isActive: user.isActive,
    branchId,
    isHeadOffice,
    roles,
    permissions: permissionSet,
    branchAccess,
    fieldPermissions,
    reportPermissions,
  };
}

// ─────────────────────────────────────────────
// BUILD PERMISSION SET FROM ROLES
// ─────────────────────────────────────────────
function buildPermissionSetFromRoles(
  userRoles: Array<{
    branchId: string | null;
    role: {
      id: string;
      slug: string;
      priority: number;
      permissions: Array<{
        effect: string;
        conditions: unknown;
        permission: {
          module: { slug: string };
          action: { slug: string };
        };
      }>;
    };
  }>,
  activeBranchId: string | null
): PermissionSet {
  const granted = new Set<string>();
  const denied = new Set<string>();
  const conditions = new Map<string, PermissionConditions>();

  for (const userRole of userRoles) {
    // Skip branch-specific roles that don't apply to the active branch
    if (userRole.branchId !== null && userRole.branchId !== activeBranchId) {
      continue;
    }

    for (const rp of userRole.role.permissions) {
      const permKey = `${rp.permission.module.slug}:${rp.permission.action.slug}`;

      if (rp.effect === 'DENY') {
        denied.add(permKey);
        granted.delete(permKey);
      } else if (!denied.has(permKey)) {
        granted.add(permKey);
        if (rp.conditions) {
          conditions.set(permKey, rp.conditions as PermissionConditions);
        }
      }
    }
  }

  return { granted, denied, conditions };
}

// ─────────────────────────────────────────────
// ADMIN BYPASS — the admin role always has full, unconditional access.
// Guards every check below so a missing RolePermission/FieldPermission/
// ReportPermission row (or branch-access row) never silently denies Admin.
// ─────────────────────────────────────────────
function isAdminContext(context: UserContext): boolean {
  return context.roles.some((r) => r.roleSlug === 'admin');
}

// ─────────────────────────────────────────────
// CHECK PERMISSION
// ─────────────────────────────────────────────
export function checkPermission(
  context: UserContext,
  request: PermissionCheckRequest
): PermissionCheckResult {
  if (isAdminContext(context)) return { allowed: true };

  const { moduleSlug, actionSlug, branchId, recordBranchId } = request;
  const permKey = `${moduleSlug}:${actionSlug}`;

  if (context.permissions.denied.has(permKey)) {
    return { allowed: false, reason: 'Permission explicitly denied' };
  }

  if (!context.permissions.granted.has(permKey)) {
    return { allowed: false, reason: `No permission: ${permKey}` };
  }

  const permConditions = context.permissions.conditions.get(permKey);
  if (permConditions) {
    const abacResult = evaluateABACConditions(context, request, permConditions);
    if (!abacResult.allowed) return abacResult;
  }

  if (branchId && branchId !== context.branchId) {
    const hasBranchAccess = context.branchAccess.some(
      (ba) => ba.branchId === branchId && ba.accessType !== 'REPORTING'
    );
    if (!hasBranchAccess) {
      return { allowed: false, reason: 'No access to that branch' };
    }
  }

  return { allowed: true, conditions: permConditions };
}

// ─────────────────────────────────────────────
// ABAC CONDITIONS EVALUATOR
// ─────────────────────────────────────────────
function evaluateABACConditions(
  context: UserContext,
  request: PermissionCheckRequest,
  conditions: PermissionConditions
): PermissionCheckResult {
  if (conditions.branchScope === 'own') {
    if (request.recordBranchId && request.recordBranchId !== context.branchId) {
      return { allowed: false, reason: 'Restricted to own branch' };
    }
  }

  if (conditions.branchScope === 'assigned') {
    const ids = context.branchAccess.map((ba) => ba.branchId);
    if (request.recordBranchId && !ids.includes(request.recordBranchId)) {
      return { allowed: false, reason: 'Branch not in assigned list' };
    }
  }

  if (conditions.recordOwnership === 'self') {
    if (request.recordOwnerId && request.recordOwnerId !== context.userId) {
      return { allowed: false, reason: 'Restricted to own records' };
    }
  }

  if (
    conditions.maxAmount !== undefined &&
    request.metadata?.amount !== undefined &&
    (request.metadata.amount as number) > conditions.maxAmount
  ) {
    return { allowed: false, reason: `Exceeds permitted limit of ${conditions.maxAmount}` };
  }

  return { allowed: true };
}

// ─────────────────────────────────────────────
// FIELD PERMISSION
// ─────────────────────────────────────────────
export function checkFieldPermission(
  context: UserContext,
  moduleSlug: string,
  fieldName: string
): 'VISIBLE' | 'READONLY' | 'HIDDEN' | 'MASKED' {
  if (isAdminContext(context)) return 'VISIBLE';
  const key = `${moduleSlug}:${fieldName}`;
  return context.fieldPermissions.get(key)?.access ?? 'VISIBLE';
}

// ─────────────────────────────────────────────
// REPORT PERMISSION
// ─────────────────────────────────────────────
export function checkReportPermission(
  context: UserContext,
  reportSlug: string
): ReportAccessResult {
  if (isAdminContext(context)) {
    // exportMode is a performance/queueing control, not an access grant — Admin's
    // own ReportPermission row is kept in sync by the report-permissions admin
    // screen, so honor it instead of always forcing DIRECT.
    const configured = context.reportPermissions.get(reportSlug);
    return {
      canView: true,
      canExport: true,
      canPrint: true,
      branchScope: 'ALL',
      maskFinancial: false,
      exportMode: configured?.exportMode ?? 'DIRECT',
    };
  }
  // No row yet for this role+report (e.g. a freshly-registered report before an
  // admin has visited Report Permissions, or before the seed backfill has run
  // for it) — canView/canExport/canPrint must default to true here, matching
  // the documented "always allowed for every role" intent (see
  // app/api/admin/report-permissions/route.ts and the equivalent client-side
  // default in app/hooks/usePermission.ts's canExportReport). Defaulting to
  // false here previously left the client (which already defaults true) and
  // server disagreeing — a report configured for Request Queue export would
  // show its Export button as usable, then 403 on submit for any role with no
  // saved row yet.
  return context.reportPermissions.get(reportSlug) ?? {
    canView: true, canExport: true, canPrint: true, branchScope: 'OWN_BRANCH', maskFinancial: true, exportMode: 'DIRECT',
  };
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
async function buildBranchAccess(
  userBranchAccess: Array<{
    branchId: string;
    accessType: string;
    isPrimary: boolean;
    branch: { id: string; name: string; code: string };
  }>,
  _userId: string
): Promise<BranchAccessSummary[]> {
  return Promise.all(
    userBranchAccess.map(async (ba) => ({
      branchId: ba.branchId,
      branchName: ba.branch.name,
      branchCode: ba.branch.code,
      accessType: ba.accessType as BranchAccessSummary['accessType'],
      isPrimary: ba.isPrimary,
      isHeadOffice: await checkIsHeadOffice(ba.branchId),
    }))
  );
}

const HO_CACHE = new Map<string, boolean>();

async function checkIsHeadOffice(branchId: string | null): Promise<boolean> {
  if (!branchId) return false;
  if (HO_CACHE.has(branchId)) return HO_CACHE.get(branchId)!;

  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { code: true, name: true },
  });

  const isHO =
    branch?.code?.toUpperCase() === 'HO' ||
    branch?.name?.toLowerCase().includes('head office') ||
    false;

  HO_CACHE.set(branchId, isHO);
  return isHO;
}

async function loadFieldPermissions(roleIds: string[]): Promise<FieldPermissionMap> {
  if (roleIds.length === 0) return new Map();

  const fps = await prisma.fieldPermission.findMany({
    where: { roleId: { in: roleIds } },
    select: {
      fieldName: true,
      access: true,
      conditions: true,
      role: { select: { priority: true } },
      module: { select: { slug: true } },
    },
    orderBy: { role: { priority: 'asc' } },
  });

  const map: FieldPermissionMap = new Map();
  for (const fp of fps) {
    const key = `${fp.module.slug}:${fp.fieldName}`;
    map.set(key, {
      access: fp.access as 'VISIBLE' | 'READONLY' | 'HIDDEN' | 'MASKED',
      conditions: fp.conditions as Record<string, unknown> | undefined,
    });
  }
  return map;
}

async function loadReportPermissions(roleIds: string[]): Promise<ReportPermissionMap> {
  if (roleIds.length === 0) return new Map();

  const rps = await prisma.reportPermission.findMany({
    where: { roleId: { in: roleIds } },
  });

  const map: ReportPermissionMap = new Map();
  for (const rp of rps) {
    const existing = map.get(rp.reportSlug);
    if (!existing) {
      map.set(rp.reportSlug, {
        canView: rp.canView,
        canExport: rp.canExport,
        canPrint: rp.canPrint,
        branchScope: rp.branchScope as 'OWN_BRANCH' | 'ASSIGNED' | 'ALL' | 'REGIONAL',
        maskFinancial: rp.maskFinancial,
        exportMode: rp.exportMode as 'DIRECT' | 'REQUEST_QUEUE',
      });
    } else {
      map.set(rp.reportSlug, {
        canView: existing.canView || rp.canView,
        canExport: existing.canExport || rp.canExport,
        canPrint: existing.canPrint || rp.canPrint,
        branchScope: existing.branchScope,
        maskFinancial: existing.maskFinancial && rp.maskFinancial,
        // Most-permissive wins across a multi-role user, same as the booleans above —
        // DIRECT (unrestricted download) beats REQUEST_QUEUE (download only via Request Report).
        exportMode: existing.exportMode === 'DIRECT' || rp.exportMode === 'DIRECT' ? 'DIRECT' : 'REQUEST_QUEUE',
      });
    }
  }
  return map;
}

// ─────────────────────────────────────────────
// INVALIDATE USER PERMISSIONS
// Call when user's roles or permissions change
// ─────────────────────────────────────────────
export async function invalidateUserPermissions(userId: string): Promise<void> {
  await permissionCache.invalidate(userId);

  await prisma.permissionCacheVersion.upsert({
    where: { userId },
    create: { userId, version: 1 },
    update: { version: { increment: 1 } },
  });
}

// ─────────────────────────────────────────────
// GET PERMISSION VERSION — embedded in JWT at login
// ─────────────────────────────────────────────
export async function getPermissionVersion(userId: string): Promise<number> {
  const record = await prisma.permissionCacheVersion.findUnique({
    where: { userId },
  });
  return record?.version ?? 1;
}
