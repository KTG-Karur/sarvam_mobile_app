// app/api/admin/users/[userId]/roles/route.ts
// Assign / Remove roles for a specific user

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/prisma';
import { requirePermission, isUserContext } from '@/app/lib/permissions/guards';
import { invalidateUserPermissions } from '@/app/lib/permissions/engine';
import { syncUserLegacyRoleFromActiveAssignments } from '@/app/lib/rbac-role-sync';

const AssignRoleSchema = z.object({
  roleId: z.string(),
  branchId: z.string().nullable().optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

const RemoveRoleSchema = z.object({
  roleId: z.string(),
  branchId: z.string().nullable().optional(),
});

// GET — list roles of a user
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;
  const result = await requirePermission(request, 'admin', 'view');
  if (!isUserContext(result)) return result;

  const userRoles = await prisma.userRoleAssignment.findMany({
    where: { userId: userId },
    include: {
      role: {
        select: { id: true, name: true, slug: true, color: true, priority: true, isActive: true },
      },
      branch: { select: { id: true, name: true, code: true } },
    },
    orderBy: { role: { priority: 'desc' } },
  });

  return NextResponse.json({ success: true, userRoles });
}

// POST — assign a role to a user
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;
  const result = await requirePermission(request, 'admin', 'edit');
  if (!isUserContext(result)) return result;

  const body = await request.json();
  const parsed = AssignRoleSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
  }

  const role = await prisma.role.findUnique({ where: { id: parsed.data.roleId } });
  if (!role || !role.isActive) {
    return NextResponse.json(
      { success: false, error: 'Role not found or inactive' },
      { status: 404 }
    );
  }

  if (parsed.data.branchId) {
    const branchAccess = await prisma.userBranchAccess.findUnique({
      where: { userId_branchId: { userId: userId, branchId: parsed.data.branchId } },
    });
    if (!branchAccess) {
      return NextResponse.json(
        { success: false, error: 'User does not have access to this branch. Grant branch access first.' },
        { status: 400 }
      );
    }
  }

  const userRole = await prisma.userRoleAssignment.upsert({
    where: {
      userId_roleId_branchId: {
        userId: userId,
        roleId: parsed.data.roleId,
        branchId: (parsed.data.branchId || null) as any,
      },
    },
    create: {
      userId: userId,
      roleId: parsed.data.roleId,
      ...(parsed.data.branchId ? { branchId: parsed.data.branchId } : {}),
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
      assignedBy: result.userId,
      isActive: true,
    },
    update: {
      isActive: true,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
      assignedBy: result.userId,
    },
  });

  // Keep User.role (JWT claim, used by legacy withRole()/sidebar checks) in
  // step with the user's actual highest-priority active RBAC role — otherwise
  // a stale User.role (e.g. still "ADMIN") keeps granting old, wider access
  // regardless of this role's configured pagePermissions.
  await syncUserLegacyRoleFromActiveAssignments(userId);
  await invalidateUserPermissions(userId);

  await prisma.roleAuditLog.create({
    data: {
      actedBy: result.userId,
      action: 'role_assigned',
      targetType: 'user_role',
      targetId: userRole.id,
      after: { userId: userId, roleId: parsed.data.roleId, roleName: role.name },
    },
  });

  return NextResponse.json({ success: true, userRole }, { status: 201 });
}

// DELETE — remove a role from a user
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  const { userId } = await params;
  const result = await requirePermission(request, 'admin', 'edit');
  if (!isUserContext(result)) return result;

  const body = await request.json();
  const parsed = RemoveRoleSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ success: false, error: 'Validation failed' }, { status: 400 });
  }

  const userRole = await prisma.userRoleAssignment.findUnique({
    where: {
      userId_roleId_branchId: {
        userId: userId,
        roleId: parsed.data.roleId,
        branchId: (parsed.data.branchId ?? null) as any,
      },
    },
    include: { role: { select: { name: true } } },
  });

  if (!userRole) {
    return NextResponse.json({ success: false, error: 'Role assignment not found' }, { status: 404 });
  }

  await prisma.userRoleAssignment.update({
    where: { id: userRole.id },
    data: { isActive: false },
  });

  await syncUserLegacyRoleFromActiveAssignments(userId);
  await invalidateUserPermissions(userId);

  await prisma.roleAuditLog.create({
    data: {
      actedBy: result.userId,
      action: 'role_removed',
      targetType: 'user_role',
      targetId: userRole.id,
      before: { userId: userId, roleId: parsed.data.roleId, roleName: userRole.role.name },
    },
  });

  return NextResponse.json({ success: true });
}
