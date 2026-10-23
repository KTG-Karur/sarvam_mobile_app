/**
 * Role Display Utility
 * Single source of truth for converting a user's role data into a human-readable label.
 *
 * Priority order:
 *   1. rbacRoleName  — exact name from the RBAC Role record (most accurate)
 *   2. rbacRoleSlug  — title-cased slug for old sessions that predate rbacRoleName
 *   3. Legacy label  — ADMIN / BRANCH_MANAGER / AREA_MANAGER / FDO enum labels
 *   4. Raw role      — formatted as last resort
 *
 * Use this function everywhere a user's role needs to be displayed in the UI so
 * that custom roles (e.g. "Background Verification Team") are always shown correctly
 * instead of the legacy enum fallback ("Field Development Officer").
 */

/** Mapping from legacy UserRole enum values to human-readable labels. */
export const LEGACY_ROLE_LABELS: Record<string, string> = {
    ADMIN:                        'Admin',
    BRANCH_MANAGER:               'Branch Manager',
    AREA_MANAGER:                 'Area Manager',
    FDO:                          'Field Development Officer',
    ADMIN_NON_HO_BRANCH_SWITCH:   'Admin (Non-HO Branch)',
    DIVISION_MANAGER:             'Division Manager',
    QC:                           'Quality Checkers',
};

/** Slugs that map directly to system roles — skip slug→title conversion for these. */
const LEGACY_ROLE_SLUGS = new Set([
    'admin', 'area-manager', 'branch-manager', 'fdo',
    'quality-checkers', 'division-manager',
]);

/**
 * Convert a kebab-case role slug to Title Case.
 * "background-verification-team" → "Background Verification Team"
 */
function slugToTitle(slug: string): string {
    return slug.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Returns the correct human-readable role label for display in the UI.
 *
 * Accepts any object that may have `role`, `rbacRoleName`, or `rbacRoleSlug`.
 * Safe to call with a partial object — all fields are optional.
 */
export function getRoleDisplayName(user: {
    role?: string | null;
    rbacRoleName?: string | null;
    rbacRoleSlug?: string | null;
}): string {
    // 1. Explicit RBAC role name (stored since v2 of login route)
    if (user.rbacRoleName) return user.rbacRoleName;

    // 2. Convert custom slug to Title Case (handles sessions created before rbacRoleName was added)
    if (user.rbacRoleSlug && !LEGACY_ROLE_SLUGS.has(user.rbacRoleSlug)) {
        return slugToTitle(user.rbacRoleSlug);
    }

    // 3. Legacy enum label
    const label = LEGACY_ROLE_LABELS[user.role ?? ''];
    if (label) return label;

    // 4. Fallback — format raw string
    return user.role?.replace(/_/g, ' ') ?? 'User';
}
