// ============================================================
// PUBLIC ROLES ENDPOINT — Returns active RBAC roles
// app/api/roles/route.ts
//
// Used by employee creation forms to populate the role dropdown.
// Accessible to any authenticated user (not just admin).
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { requireAuth, isUserContext } from '@/app/lib/permissions/guards';
import { cachedMasterData } from '@/app/lib/cache/master-data-cache';

export async function GET(request: NextRequest) {
  const result = await requireAuth(request);
  if (!isUserContext(result)) return result;

  try {
    const roles = await cachedMasterData('roles', 'active', () =>
      prisma.role.findMany({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          slug: true,
          description: true,
          color: true,
          priority: true,
          legacyRole: true,  // exposed so EmployeeForm can derive the correct UserRole enum
        },
        orderBy: [{ priority: 'desc' }, { name: 'asc' }],
      })
    );

    return NextResponse.json({ success: true, data: roles });
  } catch (error) {
    console.error('Error fetching roles:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch roles' },
      { status: 500 }
    );
  }
}
