// ============================================================
// CLONE ROLE — Duplicate a role with all its permissions
// app/api/admin/roles/[roleId]/clone/route.ts
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/prisma';
import { requirePermission, isUserContext } from '@/app/lib/permissions/guards';
import { computeRoleCode } from '@/app/lib/rbac-role-sync';
import { bumpMasterDataVersion } from '@/app/lib/cache/master-data-cache';

const CloneRoleSchema = z.object({
  name: z.string().min(2),
  slug: z.string().regex(/^[a-z0-9-]+$/),
  description: z.string().optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roleId: string }> }
) {
  const { roleId } = await params;
  const result = await requirePermission(request, 'admin', 'create');
  if (!isUserContext(result)) return result;

  const body = await request.json();
  const parsed = CloneRoleSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Load source role with all its permissions
  const sourceRole = await prisma.role.findUnique({
    where: { id: roleId },
    include: { permissions: true },
  });

  if (!sourceRole) {
    return NextResponse.json({ success: false, error: 'Role not found' }, { status: 404 });
  }

  // Check slug uniqueness
  const slugExists = await prisma.role.findUnique({ where: { slug: parsed.data.slug } });
  if (slugExists) {
    return NextResponse.json(
      { success: false, error: `Slug '${parsed.data.slug}' already in use` },
      { status: 409 }
    );
  }

  // Clone in transaction
  const clonedRole = await prisma.$transaction(async (tx) => {
    const newRole = await tx.role.create({
      data: {
        name: parsed.data.name,
        slug: parsed.data.slug,
        description: parsed.data.description ?? `Cloned from ${sourceRole.name}`,
        color: sourceRole.color,
        priority: sourceRole.priority,
        parentRoleId: sourceRole.parentRoleId,
        isActive: true,
        isSystem: false, // Clones are never system-protected
        // Cloned roles must not silently inherit the schema default ("FDO") —
        // compute a real code from the new name so User.role sync stays correct.
        legacyRole: computeRoleCode(parsed.data.name),
      },
    });

    // Clone all permissions
    if (sourceRole.permissions.length > 0) {
      await tx.rolePermission.createMany({
        data: sourceRole.permissions.map((rp) => ({
          roleId: newRole.id,
          permissionId: rp.permissionId,
          effect: rp.effect,
          ...(rp.conditions ? { conditions: rp.conditions } : {}),
        })),
      });
    }

    // Audit log
    await tx.roleAuditLog.create({
      data: {
        actedBy: result.userId,
        action: 'role_cloned',
        targetType: 'role',
        targetId: newRole.id,
        before: { sourceRoleId: sourceRole.id, sourceRoleName: sourceRole.name },
        after: { newRoleId: newRole.id, newRoleName: newRole.name },
      },
    });

    return newRole;
  });

  await bumpMasterDataVersion('roles');
  return NextResponse.json({
    success: true,
    role: clonedRole,
    clonedPermissions: sourceRole.permissions.length,
  });
}
