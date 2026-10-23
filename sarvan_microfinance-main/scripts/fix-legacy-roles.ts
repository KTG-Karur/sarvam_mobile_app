/**
 * scripts/fix-legacy-roles.ts
 * One-shot script: updates legacyRole on system roles in the DB.
 * Run with: npx tsx scripts/fix-legacy-roles.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SYSTEM_ROLE_FIXES = [
  { slug: 'admin',            legacyRole: 'ADMIN' },
  { slug: 'area-manager',     legacyRole: 'AREA_MANAGER' },
  { slug: 'branch-manager',   legacyRole: 'BRANCH_MANAGER' },
  { slug: 'fdo',              legacyRole: 'FDO' },
  { slug: 'quality-checkers', legacyRole: 'QC' },
  { slug: 'division-manager', legacyRole: 'DIVISION_MANAGER' },
];

async function main() {
  console.log('🔧 Fixing legacyRole on system roles...\n');

  for (const { slug, legacyRole } of SYSTEM_ROLE_FIXES) {
    const existing = await prisma.role.findUnique({ where: { slug } });
    if (!existing) {
      console.log(`  ⚠  Role slug "${slug}" not found — skipping`);
      continue;
    }

    if (existing.legacyRole === legacyRole) {
      console.log(`  ✓  ${slug}: already correct (${legacyRole})`);
      continue;
    }

    await prisma.role.update({
      where: { slug },
      data: { legacyRole },
    });
    console.log(`  ✅  ${slug}: ${existing.legacyRole}  →  ${legacyRole}`);
  }

  console.log('\n✅ Done. legacyRole values are now correct.');
}

main()
  .catch((e) => { console.error('❌ Error:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
