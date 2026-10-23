// ============================================================
// PERMISSION HOOK — Client-side permission checks
// app/hooks/usePermission.ts
//
// Usage:
//   const { can, cannot, hasRole } = usePermission();
//   if (can('loan', 'approve')) { ... }
//   if (hasRole('branch-manager')) { ... }
// ============================================================

'use client';

import { useCallback } from 'react';
import { useAuthStore } from '@/app/store/authStore';

export function usePermission() {
  const permissions = useAuthStore((s) => s.permissions);
  const pagePermissions = useAuthStore((s) => s.pagePermissions);
  const roles = useAuthStore((s) => s.roles);
  const branchAccess = useAuthStore((s) => s.branchAccess);
  const isHeadOffice = useAuthStore((s) => s.isHeadOffice);

  // Admin always has every permission/page/field — regardless of branch and
  // regardless of whether the DB-seeded RolePermission/pagePermissions rows
  // are complete, so a missed seed entry never silently blocks Admin.
  const isAdmin = roles?.some((r) => r.roleSlug === 'admin') ?? false;

  // ── Check single permission ──
  const can = useCallback(
    (moduleSlug: string, actionSlug: string): boolean => {
      if (isAdmin) return true;
      if (!permissions) return false;
      const key = `${moduleSlug}:${actionSlug}`;
      return permissions.granted.has(key) && !permissions.denied.has(key);
    },
    [permissions, isAdmin]
  );

  const cannot = useCallback(
    (moduleSlug: string, actionSlug: string): boolean => !can(moduleSlug, actionSlug),
    [can]
  );

  // ── Check any permission ──
  const canAny = useCallback(
    (checks: Array<[string, string]>): boolean =>
      checks.some(([mod, action]) => can(mod, action)),
    [can]
  );

  // ── Check all permissions ──
  const canAll = useCallback(
    (checks: Array<[string, string]>): boolean =>
      checks.every(([mod, action]) => can(mod, action)),
    [can]
  );

  // ── Page-level permission check ──
  // Reads from pagePermissions (set by admin panel via /api/admin/roles/[id]/page-permissions).
  // If pagePermissions is null (not configured / not yet loaded), defaults to TRUE —
  //   role-based sidebar allowedRoles already controls page visibility.
  // If pagePermissions is configured, only returns true when the specific page+action is granted.
  //
  // NOTE: We intentionally do NOT fall back to localStorage here. The localStorage copy
  // (sarvan-page-permissions) is written for sidebar use; reading it in canPage causes
  // stale-data bugs (old approve:false blocks a user after admin grants approve:true).
  const canPage = useCallback(
    (href: string, action: 'view' | 'add' | 'edit' | 'delete' | 'approve'): boolean => {
      if (isAdmin) return true;

      // Not configured (or not yet loaded) → allow everything
      if (pagePermissions === null) return true;

      // Config exists in store — check explicitly granted actions
      const pagePerms = pagePermissions[href];
      // Page not listed → deny (admin must explicitly grant; save always writes all nav pages)
      if (!pagePerms) return false;
      return pagePerms[action] === true;
    },
    [pagePermissions, isAdmin]
  );

  // ── Role checks ──
  const hasRole = useCallback(
    (roleSlug: string): boolean =>
      roles?.some((r) => r.roleSlug === roleSlug) ?? false,
    [roles]
  );

  const hasAnyRole = useCallback(
    (roleSlugs: string[]): boolean =>
      roles?.some((r) => roleSlugs.includes(r.roleSlug)) ?? false,
    [roles]
  );

  // ── Branch access ──
  const hasBranchAccess = useCallback(
    (branchId: string, minType: 'FULL' | 'OPERATIONAL' | 'READONLY' | 'REPORTING' = 'READONLY'): boolean => {
      if (!branchAccess) return false;
      const ACCESS_RANK = { REPORTING: 0, READONLY: 1, OPERATIONAL: 2, FULL: 3 };
      const access = branchAccess.find((ba) => ba.branchId === branchId);
      if (!access) return false;
      return ACCESS_RANK[access.accessType] >= ACCESS_RANK[minType];
    },
    [branchAccess]
  );

  // ── Report permission (Request Report export gate) ──
  // Defaults to true when no ReportPermission row exists yet for this slug+role —
  // export access is meant to be always-allowed for every role (see
  // app/api/admin/report-permissions/route.ts and prisma/seed-report-permissions.ts;
  // canExport is hardcoded true everywhere it's written, there's no UI path to deny
  // it), and rows are only backfilled lazily via that seed script or an admin
  // visiting Report Permissions — a freshly-registered report must not have its
  // export silently blocked for every non-admin role until that happens.
  const canExportReport = useCallback(
    (reportSlug: string): boolean => {
      if (isAdmin) return true;
      const reportPermissions = useAuthStore.getState().reportPermissions;
      return reportPermissions?.[reportSlug]?.canExport ?? true;
    },
    [isAdmin]
  );

  // ── Export mode (DIRECT = downloads immediately; REQUEST_QUEUE = only
  // downloadable from /dashboard/reports/request-report) ──
  // NOTE: unlike the other checks above, this intentionally does NOT bypass
  // for Admin — exportMode is a performance/queueing control (not an access
  // grant), and Admin's own ReportPermission row is kept in sync by the
  // report-permissions admin screen, so it should be honored the same way.
  const getReportExportMode = useCallback(
    (reportSlug: string): 'DIRECT' | 'REQUEST_QUEUE' => {
      const reportPermissions = useAuthStore.getState().reportPermissions;
      return reportPermissions?.[reportSlug]?.exportMode ?? 'DIRECT';
    },
    []
  );

  // ── Field permission ──
  const getFieldAccess = useCallback(
    (moduleSlug: string, fieldName: string): 'VISIBLE' | 'READONLY' | 'HIDDEN' | 'MASKED' => {
      if (isAdmin) return 'VISIBLE';
      const key = `${moduleSlug}:${fieldName}`;
      return ((useAuthStore.getState().fieldPermissions?.[key]?.access) ?? 'VISIBLE') as 'VISIBLE' | 'READONLY' | 'HIDDEN' | 'MASKED';
    },
    [isAdmin]
  );

  return {
    can,
    cannot,
    canAny,
    canAll,
    canPage,
    hasRole,
    hasAnyRole,
    hasBranchAccess,
    getFieldAccess,
    canExportReport,
    getReportExportMode,
    isHeadOffice: isHeadOffice ?? false,
    roles: roles ?? [],
    branchAccess: branchAccess ?? [],
  };
}
