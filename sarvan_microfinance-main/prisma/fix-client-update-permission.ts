// ============================================================
// FIX: Add /dashboard/client/client-update to FDO permissions
// prisma/fix-client-update-permission.ts
//
// Run: npx tsx prisma/fix-client-update-permission.ts
//
// Problem: The new /dashboard/client/client-update page is not visible
// in the sidebar for FDO users because the pagePermissions JSON in the
// database doesn't include this href yet.
//
// Solution: This script updates the pagePermissions JSON for FDO role
// to add /dashboard/client/client-update with full actions (view, add, edit, delete, approve).
//
// IMPORTANT: Users must log out and log back in after running this script
// because the permissions are cached in localStorage.
// ============================================================

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🔧 Fixing /dashboard/client/client-update permission for FDO...\n');

  // Build the new page entry with full actions
  const newPageEntry = {
    '/dashboard/client/client-update': {
      view: true,
      add: true,
      edit: true,
      delete: true,
      approve: true,
    },
  };

  // Find the FDO role
  const fdoRole = await prisma.role.findFirst({
    where: { slug: 'fdo', isActive: true },
    select: { id: true, slug: true, name: true, pagePermissions: true },
  });

  if (!fdoRole) {
    console.error('❌ FDO role not found in database. Run seed-rbac.ts first.');
    process.exit(1);
  }

  // Get existing permissions and merge in the new entry
  const existingPerms = (fdoRole.pagePermissions as Record<string, unknown>) ?? {};
  const updatedPerms = { ...existingPerms, ...newPageEntry };

  // Update the database
  await prisma.$executeRawUnsafe(
    `UPDATE roles SET "pagePermissions" = $1::jsonb, "updatedAt" = NOW() WHERE id = $2`,
    JSON.stringify(updatedPerms),
    fdoRole.id
  );

  const totalPages = Object.keys(updatedPerms).length;
  console.log(`✅ Updated FDO role (${fdoRole.name})`);
  console.log(`   Added: /dashboard/client/client-update`);
  console.log(`   Total visible pages: ${totalPages}\n`);

  console.log('⚠️  IMPORTANT: Users must log out and log back in');
  console.log('   for the sidebar to show the new page.\n');
  console.log('✅ Done!');
}

main()
  .catch((error) => {
    console.error('❌ Error:', error.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
