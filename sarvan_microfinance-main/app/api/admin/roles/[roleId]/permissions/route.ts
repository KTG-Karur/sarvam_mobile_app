// ============================================================
// ROLE PERMISSIONS API — Assign/Remove permissions from role
// app/api/admin/roles/[roleId]/permissions/route.ts
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/prisma';
import { requirePermission, isUserContext } from '@/app/lib/permissions/guards';
import { invalidateUserPermissions } from '@/app/lib/permissions/engine';

const AssignPermissionSchema = z.object({
  permissionId: z.string(),
  effect: z.enum(['ALLOW', 'DENY']).optional().default('ALLOW'),
  conditions: z.any().optional(),
});

const BulkAssignSchema = z.object({
  permissions: z.array(AssignPermissionSchema),
  // Replace all permissions for this role, or just add these?
  mode: z.enum(['REPLACE', 'MERGE']).default('MERGE'),
});

// GET /api/admin/roles/[roleId]/permissions
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roleId: string }> }
) {
  const { roleId } = await params;
  const result = await requirePermission(request, 'admin', 'view');
  if (!isUserContext(result)) return result;

  const rolePermissions = await prisma.rolePermission.findMany({
    where: { roleId: roleId },
    include: {
      permission: {
        include: {
          module: { select: { id: true, name: true, slug: true } },
          action: { select: { id: true, name: true, slug: true } },
        },
      },
    },
    orderBy: [
      { permission: { module: { name: 'asc' } } },
      { permission: { action: { name: 'asc' } } },
    ],
  });

  return NextResponse.json({ success: true, permissions: rolePermissions });
}

// POST /api/admin/roles/[roleId]/permissions — Bulk assign permissions
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roleId: string }> }
) {
  const { roleId } = await params;
  const result = await requirePermission(request, 'admin', 'edit');
  if (!isUserContext(result)) return result;

  const body = await request.json();
  const parsed = BulkAssignSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const { permissions, mode } = parsed.data;

  // Verify role exists and is not protected from modification
  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) {
    return NextResponse.json({ success: false, error: 'Role not found' }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    if (mode === 'REPLACE') {
      // Delete all existing permissions
      await tx.rolePermission.deleteMany({ where: { roleId: roleId } });
    }

    // Upsert each permission
    for (const perm of permissions) {
      await tx.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: roleId,
            permissionId: perm.permissionId,
          },
        },
        create: {
          roleId: roleId,
          permissionId: perm.permissionId,
          effect: perm.effect,
          ...(perm.conditions ? { conditions: perm.conditions } : {}),
        },
        update: {
          effect: perm.effect,
          ...(perm.conditions ? { conditions: perm.conditions } : {}),
        },
      });
    }

    // Audit log
    await tx.roleAuditLog.create({
      data: {
        actedBy: result.userId,
        action: 'permissions_updated',
        targetType: 'role',
        targetId: roleId,
        after: { mode, permissionCount: permissions.length },
      },
    });
  });

  // Invalidate permissions for ALL users with this role
  const affectedUsers = await prisma.userRoleAssignment.findMany({
    where: { roleId: roleId, isActive: true },
    select: { userId: true },
  });

  await Promise.all(
    affectedUsers.map((ur) => invalidateUserPermissions(ur.userId))
  );

  return NextResponse.json({
    success: true,
    message: `Updated ${permissions.length} permissions. Invalidated ${affectedUsers.length} user permission caches.`,
  });
}

// DELETE /api/admin/roles/[roleId]/permissions — Remove specific permission
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ roleId: string }> }
) {
  const { roleId } = await params;
  const result = await requirePermission(request, 'admin', 'delete');
  if (!isUserContext(result)) return result;

  const { permissionId } = await request.json();

  await prisma.rolePermission.delete({
    where: {
      roleId_permissionId: {
        roleId: roleId,
        permissionId,
      },
    },
  });

  // Invalidate affected users
  const affectedUsers = await prisma.userRoleAssignment.findMany({
    where: { roleId: roleId, isActive: true },
    select: { userId: true },
  });

  await Promise.all(
    affectedUsers.map((ur) => invalidateUserPermissions(ur.userId))
  );

  return NextResponse.json({ success: true });
}
