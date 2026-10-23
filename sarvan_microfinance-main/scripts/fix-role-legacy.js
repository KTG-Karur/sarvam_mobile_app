/**
 * scripts/fix-role-legacy.js
 *
 * Recomputes legacyRole for ALL RBAC roles:
 *  - System roles keep their exact values (ADMIN, BRANCH_MANAGER, FDO, AREA_MANAGER, DIVISION_MANAGER)
 *  - Custom roles auto-compute from name:
 *      Single word  → full name UPPERCASED        e.g. "Pune" → "PUNE"
 *      Multi word   → first letter of each word   e.g. "Background Verification Team" → "BVT"
 *                                                       "Human Resource Executive"    → "HRE"
 *
 * Run AFTER prisma generate:
 *   node scripts/fix-role-legacy.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// System role slugs — fixed legacyRole values, never auto-computed
const SYSTEM_ROLE_OVERRIDES = {
  'admin':                       'ADMIN',
  'branch-manager':              'BRANCH_MANAGER',
  'area-manager':                'AREA_MANAGER',
  'fdo':                         'FDO',
  'division-manager':            'DIVISION_MANAGER',
  'quality-checkers':            'QC',   // renamed from background-verification-team
  'background-verification-team':'QC',   // legacy slug — same code
  'background-verification':     'QC',   // legacy alias
};

/**
 * Compute role code from display name.
 * Mirrors computeRoleCode() in app/api/admin/roles/route.ts
 */
function computeRoleCode(name) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].toUpperCase();
  return words.map((w) => w[0].toUpperCase()).join('');
}

async function main() {
  const roles = await prisma.role.findMany({
    select: { id: true, name: true, slug: true, legacyRole: true, isSystem: true },
    orderBy: { priority: 'desc' },
  });

  console.log(`\nFound ${roles.length} role(s). Processing...\n`);

  let updated = 0;
  let skipped = 0;

  for (const role of roles) {
    // Determine target legacyRole
    const target =
      SYSTEM_ROLE_OVERRIDES[role.slug] ??   // system override takes priority
      computeRoleCode(role.name);            // custom → auto-compute

    const prev = role.legacyRole;

    if (target === prev) {
      console.log(`  OK     "${role.name.padEnd(40)}"  legacyRole = "${prev}" (no change)`);
      skipped++;
      continue;
    }

    await prisma.role.update({
      where: { id: role.id },
      data:  { legacyRole: target },
    });

    console.log(`  UPDATE "${role.name.padEnd(40)}"  legacyRole: "${prev}" → "${target}"`);
    updated++;
  }

  console.log(`\n✅ Done: ${updated} updated, ${skipped} unchanged.\n`);

  console.log('Current role codes:');
  const all = await prisma.role.findMany({
    select: { name: true, slug: true, legacyRole: true },
    orderBy: { priority: 'desc' },
  });
  all.forEach((r) =>
    console.log(`  ${r.slug.padEnd(36)} ${String(r.legacyRole).padEnd(24)} ${r.name}`)
  );
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
