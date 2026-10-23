// app/api/admin/users/[userId]/route.ts
// GET a single user with all RBAC data (for role assignment page)

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { requirePermission, isUserContext } from '@/app/lib/permissions/guards';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;
  const result = await requirePermission(request, 'admin', 'view');
  if (!isUserContext(result)) return result;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      employeeId: true,
      isActive: true,
      branchId: true,
      branch: { select: { id: true, name: true, code: true } },
      // New RBAC
      userRoles: {
        where: { isActive: true },
        include: {
          role: { select: { id: true, name: true, slug: true, color: true, priority: true, isActive: true } },
          branch: { select: { id: true, name: true, code: true } },
        },
      },
      userBranchAccess: {
        where: { isActive: true },
        include: {
          branch: { select: { id: true, name: true, code: true } },
        },
        orderBy: [{ isPrimary: 'desc' }, { branch: { name: 'asc' } }],
      },
    },
  });

  if (!user) {
    return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true, user });
}
