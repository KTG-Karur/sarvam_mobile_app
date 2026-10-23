// ============================================================
// RBAC ROLE SYNC — keeps User.role (the code embedded in the JWT and
// checked by legacy withRole()/allowedRoles gates) in step with a
// user's actual active UserRoleAssignment.
//
// Without this, reassigning a user's RBAC role (e.g. Admin -> a custom
// restricted role) leaves the old User.role in place, so the JWT still
// claims the old role and the user keeps whatever access that role had
// (most visibly: the sidebar's "Head-Office Admin sees everything"
// shortcut in components/layout/AppSidebar.tsx, which trusts User.role
// over the configured Role.pagePermissions).
// ============================================================

import { prisma } from '@/app/lib/prisma';

/**
 * Maps built-in RBAC role slugs to the legacy role code stored on User.role / JWT.
 * Authoritative for system roles — guards against a stale/default `legacyRole`
 * value on roles seeded without one explicitly set.
 */
export const SYSTEM_SLUG_TO_ROLE: Record<string, string> = {
    admin: 'ADMIN',
    'area-manager': 'AREA_MANAGER',
    'branch-manager': 'BRANCH_MANAGER',
    fdo: 'FDO',
    'division-manager': 'DIVISION_MANAGER',
    'quality-checkers': 'QC',
};

/**
 * Auto-generates a role code from a role name, for custom roles that don't
 * explicitly set one.
 *  - Single word  → full word, UPPERCASED        e.g. "Pune" → "PUNE"
 *  - Multi word   → first letter of each word     e.g. "Chief Administrative Officer" → "CAO"
 */
export function computeRoleCode(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean);
    if (words.length === 1) return words[0].toUpperCase();
    return words.map((w) => w[0].toUpperCase()).join('');
}

/** Resolves the legacy role code (User.role / JWT claim) for a given RBAC role. */
export function resolveLegacyRoleForRbacRole(role: { slug: string; legacyRole: string }): string {
    return SYSTEM_SLUG_TO_ROLE[role.slug] ?? role.legacyRole;
}

/**
 * Recomputes and persists User.role from the user's currently active (and
 * unexpired) RBAC role assignments — the highest-priority active role wins.
 * Call this after any UserRoleAssignment create/update/deactivate.
 *
 * Leaves User.role untouched if the user has no active assignment (avoids
 * guessing / accidentally locking someone out) — the caller's explicit
 * `role` field (if any) always takes precedence over this.
 *
 * Returns the new role code, or null if nothing changed.
 */
export async function syncUserLegacyRoleFromActiveAssignments(userId: string): Promise<string | null> {
    const active = await prisma.userRoleAssignment.findMany({
        where: {
            userId,
            isActive: true,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            role: { isActive: true },
        },
        include: { role: { select: { slug: true, legacyRole: true, priority: true } } },
        orderBy: [{ role: { priority: 'desc' } }, { updatedAt: 'desc' }],
    });

    const top = active[0];
    if (!top) return null;

    const nextRole = resolveLegacyRoleForRbacRole(top.role);

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user || user.role === nextRole) return null;

    await prisma.user.update({ where: { id: userId }, data: { role: nextRole } });
    return nextRole;
}
