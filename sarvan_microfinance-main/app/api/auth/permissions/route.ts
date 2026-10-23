// ============================================================
// USER PERMISSIONS ENDPOINT — NEW
// app/api/auth/permissions/route.ts
//
// Returns full permission set for the current user.
// Called after login to hydrate client-side permission context.
// Also used for sidebar menu generation.
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/app/lib/permissions/guards';
import { isUserContext } from '@/app/lib/permissions/guards';
import type { UserContext, UserRoleSummary } from '@/app/lib/permissions/types';
import { prisma } from '@/app/lib/prisma';
import { cachedMasterData } from '@/app/lib/cache/master-data-cache';

export async function GET(request: NextRequest) {
  const result = await requireAuth(request);
  if (!isUserContext(result)) return result;

  const ctx = result as UserContext;

  // Build sidebar menu based on permissions
  const menuItems = await buildDynamicMenu(ctx);

  // ── Load page-level permissions from all the user's active RBAC roles ──
  // Merge: if ANY role grants a page, it's granted (union).
  const pagePermissions = await loadPagePermissions(ctx.roles, ctx.isHeadOffice);

  return NextResponse.json({
    success: true,
    permissions: {
      granted: Array.from(ctx.permissions.granted),
      version: ctx.roles.length > 0 ? 1 : 0,
    },
    roles: ctx.roles,
    branchAccess: ctx.branchAccess,
    fieldPermissions: Object.fromEntries(
      Array.from(ctx.fieldPermissions.entries()).map(([k, v]) => [k, v])
    ),
    reportPermissions: Object.fromEntries(
      Array.from(ctx.reportPermissions.entries()).map(([k, v]) => [k, v])
    ),
    // null = not configured (sidebar uses allowedRoles from navigation.config.ts)
    // Record<string, boolean> = explicit page access control
    pagePermissions,
    menu: menuItems,
  });
}

// ─────────────────────────────────────────────
// LOAD PAGE PERMISSIONS
// Merges pagePermissions from all active roles the user has.
// If no role has pagePermissions set, returns null (fallback to allowedRoles).
// ─────────────────────────────────────────────
async function loadPagePermissions(
  userRoles: UserRoleSummary[],
  isHeadOffice: boolean
): Promise<Record<string, Record<string, boolean>> | null> {
  if (userRoles.length === 0) return null;

  // Only Head-Office Admin gets unrestricted access. Admin working from any
  // other branch is governed by the same RBAC page permissions as any other
  // role (falls through to the merge below, same as a non-admin).
  const isAdmin = userRoles.some((r) => r.roleSlug === 'admin');
  if (isAdmin && isHeadOffice) return null; // null = no restrictions

  const roleIds = userRoles.map((r) => r.roleId);
  const roles = await prisma.role.findMany({
    where: { id: { in: roleIds }, isActive: true },
    select: { id: true, slug: true, pagePermissions: true },
  });

  // Collect roles that have pagePermissions configured
  const configured = roles.filter(
    (r) => r.pagePermissions !== null && r.pagePermissions !== undefined
  );
  if (configured.length === 0) return null; // No role has page perms → fall back to allowedRoles

  // Union: merge all role page permissions (any role granting = granted)
  // Support both old format { href: boolean } and new format { href: { view: bool, add: bool, ... } }
  const merged: Record<string, Record<string, boolean>> = {};

  for (const role of configured) {
    const perms = role.pagePermissions as Record<string, unknown>;
    for (const [href, val] of Object.entries(perms)) {
      if (!merged[href]) merged[href] = {};
      if (typeof val === 'boolean') {
        // Old format: boolean → treat as view permission
        merged[href].view = merged[href].view || val;
      } else if (typeof val === 'object' && val !== null) {
        // New format: { view, add, edit, delete, approve }
        for (const [action, allowed] of Object.entries(val as Record<string, boolean>)) {
          merged[href][action] = merged[href][action] || allowed;
        }
      }
    }
  }

  return merged;
}

// ─────────────────────────────────────────────
// BUILD DYNAMIC SIDEBAR MENU
// ─────────────────────────────────────────────
async function buildDynamicMenu(ctx: UserContext) {
  const grantedPermissions = ctx.permissions.granted;

  // The raw menu tree is identical for every user (permission filtering below
  // is what varies per user) and is never written by any API route — it's
  // seeded once via prisma/seed-rbac.ts — so this is cached globally with no
  // invalidation call anywhere in the app. If a menu-admin endpoint is ever
  // built, it must call bumpMasterDataVersion('menuItems') on every write.
  //
  // Load all menu items including their module SLUG (not just ID)
  // The permission key format is "moduleSlug:actionSlug" (e.g. "admin:view")
  // so we must join the Module table to get the slug.
  const menuItems = await cachedMasterData(
    'menuItems',
    'tree',
    () => prisma.menuItem.findMany({
      where: { isActive: true, parentId: null },
      include: {
        module: { select: { slug: true } },
        children: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
          include: {
            module: { select: { slug: true } },
          },
        },
      },
      orderBy: { sortOrder: 'asc' },
    }),
    6 * 60 * 60 // 6h — only ever changes via a re-seed, not live writes
  );

  // Filter based on permissions
  const filteredMenu = menuItems
    .map((item) => {
      // Check if user has access to this menu item
      const hasAccess = checkMenuAccess(item, grantedPermissions);

      // Filter children regardless — parent with no children is still shown
      // if it has its own path; parent with children shows if any child passes.
      const visibleChildren = item.children.filter((child) =>
        checkMenuAccess(child, grantedPermissions)
      );

      // Skip items with no access AND no visible children
      if (!hasAccess && visibleChildren.length === 0) return null;

      return {
        id: item.id,
        label: item.label,
        path: item.path,
        icon: item.icon,
        badge: item.badge,
        children: visibleChildren.map((c) => ({
          id: c.id,
          label: c.label,
          path: c.path,
          icon: c.icon,
          badge: c.badge,
        })),
      };
    })
    .filter(Boolean);

  return filteredMenu;
}

// ─────────────────────────────────────────────
// CHECK MENU ACCESS
// Uses module.slug (not moduleId) for correct permission key lookup
// ─────────────────────────────────────────────
function checkMenuAccess(
  item: {
    moduleId: string | null;
    actionSlug: string | null;
    module?: { slug: string } | null;
  },
  grantedPermissions: Set<string>
): boolean {
  // No module required — header/section labels always show
  if (!item.moduleId || !item.module) return true;

  // Build permission key as "moduleSlug:actionSlug"
  const permKey = item.actionSlug
    ? `${item.module.slug}:${item.actionSlug}`
    : `${item.module.slug}:view`;

  return grantedPermissions.has(permKey);
}
