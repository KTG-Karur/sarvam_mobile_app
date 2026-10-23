// app/api/admin/modules/route.ts
// Returns all modules + actions — used by permission matrix

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { requirePermission, isUserContext } from '@/app/lib/permissions/guards';

export async function GET(request: NextRequest) {
  const result = await requirePermission(request, 'admin', 'view');
  if (!isUserContext(result)) return result;

  const modules = await prisma.module.findMany({
    where: { isActive: true, parentId: null },
    include: {
      actions: {
        where: { isActive: true },
        orderBy: { name: 'asc' },
        include: {
          permissions: { select: { id: true } },
        },
      },
    },
    orderBy: { sortOrder: 'asc' },
  });

  return NextResponse.json({ success: true, modules });
}
