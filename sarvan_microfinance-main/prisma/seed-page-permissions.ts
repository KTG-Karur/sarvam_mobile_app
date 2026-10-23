// ============================================================
// PAGE PERMISSIONS SEEDER
// prisma/seed-page-permissions.ts
//
// Seeds default pagePermissions for each RBAC role (FDO, Branch
// Manager, Area Manager, Quality Checkers, Admin), built directly
// from navigationConfig's allowedRoles via the shared page-permission
// tree (app/lib/permissions/page-permission-tree.ts) — the exact same
// logic the Role Permissions admin screen
// (app/dashboard/admin/roles/[roleId]/permissions/page.tsx) uses to
// compute which pages exist and what actions apply to each.
//
// Previously this file hand-maintained its own copy of the nav tree,
// which drifted from navigation.config.ts over time and produced
// page/role mismatches after re-seeding. Sharing the tree builder
// removes that whole class of bug — there is now exactly one place
// that defines "which pages exist and who can see them by default".
//
// Run: npx tsx prisma/seed-page-permissions.ts
// ============================================================

import { PrismaClient } from '@prisma/client';
import { allPageEntries, type ActionKey } from '@/app/lib/permissions/page-permission-tree';

const prisma = new PrismaClient();

type PageActions = { view: boolean; add: boolean; edit: boolean; delete: boolean; approve: boolean };

function allActions(applicable: ActionKey[]): PageActions {
  return {
    view:    applicable.includes('view'),
    add:     applicable.includes('add'),
    edit:    applicable.includes('edit'),
    delete:  applicable.includes('delete'),
    approve: applicable.includes('approve'),
  };
}

function noActions(): PageActions {
  return { view: false, add: false, edit: false, delete: false, approve: false };
}

// ─────────────────────────────────────────────
// ROLE SLUG → legacy role code(s) matched against each page's allowedRoles.
//
// 'admin' is special-cased in buildPermissionsForRole below — Admin always
// gets every action on every page unconditionally (there is no branch-based
// downgrade; see app/lib/permissions/route-authorization.ts), so its legacy
// codes here are unused but kept for documentation.
// ─────────────────────────────────────────────
const ROLE_SLUG_TO_LEGACY_CODES: Record<string, string[]> = {
  'admin':            ['ADMIN'],
  'area-manager':     ['AREA_MANAGER'],
  'branch-manager':   ['BRANCH_MANAGER'],
  'fdo':              ['FDO'],
  'quality-checkers': ['QC'],
};

// ─────────────────────────────────────────────
// BUILD PAGE PERMISSIONS FOR A ROLE
// Returns Record<href, PageActions> for every page in the nav tree.
// A page with no allowedRoles configured is visible to everyone
// (matches navigation.config.ts's own "not specified = all roles" rule).
// isAdminRole grants every action on every page unconditionally, ignoring
// each page's allowedRoles — Admin is never restricted.
// ─────────────────────────────────────────────
function buildPermissionsForRole(legacyCodes: string[], isAdminRole = false): Record<string, PageActions> {
  const perms: Record<string, PageActions> = {};

  for (const entry of allPageEntries()) {
    if (isAdminRole) {
      perms[entry.href] = allActions(entry.applicableActions);
      continue;
    }
    const noRestriction = !entry.allowedRoles || entry.allowedRoles.length === 0;
    const canAccess = noRestriction || legacyCodes.some((code) => entry.allowedRoles!.includes(code));
    perms[entry.href] = canAccess ? allActions(entry.applicableActions) : noActions();
  }

  return perms;
}

// ─────────────────────────────────────────────
// MAIN — Run seed
// ─────────────────────────────────────────────
async function main() {
  console.log('🌱 Seeding page permissions for RBAC roles...\n');

  const entries = allPageEntries();
  console.log(`📄 Found ${entries.length} pages in navigation config\n`);

  const roles = await prisma.role.findMany({
    where: {
      isActive: true,
      slug: { in: Object.keys(ROLE_SLUG_TO_LEGACY_CODES) },
    },
    select: { id: true, name: true, slug: true },
  });

  if (roles.length === 0) {
    console.warn('⚠️  No matching roles found in DB. Run prisma/seed-rbac.ts first.');
    return;
  }

  for (const role of roles) {
    const legacyCodes = ROLE_SLUG_TO_LEGACY_CODES[role.slug];
    if (!legacyCodes) {
      console.log(`⏭️  Skipping ${role.name} (no legacy role mapping)`);
      continue;
    }

    const perms = buildPermissionsForRole(legacyCodes, role.slug === 'admin');
    const visibleCount = Object.values(perms).filter((a) => a.view).length;
    const jsonValue = JSON.stringify(perms);

    await prisma.$executeRawUnsafe(
      `UPDATE roles SET "pagePermissions" = $1::jsonb, "updatedAt" = NOW() WHERE id = $2`,
      jsonValue,
      role.id
    );

    console.log(`✅ ${role.name} (${role.slug}): ${visibleCount}/${entries.length} pages visible`);
  }

  console.log('\n🎉 Done! Page permissions seeded.');
  console.log('ℹ️  Users must log out and log back in for sidebar to reflect new permissions.');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
