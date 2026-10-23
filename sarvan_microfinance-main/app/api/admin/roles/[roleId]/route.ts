// app/api/admin/roles/[roleId]/route.ts
// GET / PATCH / DELETE a single role

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/prisma';
import { requirePermission, isUserContext } from '@/app/lib/permissions/guards';
import { invalidateUserPermissions } from '@/app/lib/permissions/engine';
import {
  SYSTEM_SLUG_TO_ROLE,
  syncUserLegacyRoleFromActiveAssignments,
} from '@/app/lib/rbac-role-sync';
import { bumpMasterDataVersion } from '@/app/lib/cache/master-data-cache';

// ─────────────────────────────────────────────────────────────────────────────
// Roles that are undeletable and cannot be deactivated.
// These map to legacy UserRole enum values OR are critical workflow roles.
// Equivalent to `isSystem: true` but enforced in code so no DB migration is needed.
// ─────────────────────────────────────────────────────────────────────────────
const PROTECTED_ROLE_SLUGS = new Set([
    'admin',
    'area-manager',
    'branch-manager',
    'fdo',
    'quality-checkers',              // renamed from background-verification-team — deleting breaks client approval
    'background-verification-team',  // legacy slug — kept so old data still resolves
    'background-verification',       // legacy alias
]);

const UpdateRoleSchema = z.object({
  name: z.string().min(2).max(100).optional(),
  // Form sends null for an empty description (and to clear it on edit)
  description: z.string().nullable().optional(),
  color: z.string().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  parentRoleId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
  /**
   * Role code stored on user.role in DB and JWT.
   * System roles use ADMIN / BRANCH_MANAGER / FDO / AREA_MANAGER.
   * Custom roles use auto-generated codes, e.g. "BVT", "PUNE", "HRE".
   */
  legacyRole: z.string().optional(),
  /** Grants final client-approval actions (like ADMIN), scoped to final approval only. */
  isSubAdmin: z.boolean().optional(),
});

// GET /api/admin/roles/[roleId]
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roleId: string }> }
) {
  const { roleId } = await params;
  const result = await requirePermission(request, 'admin', 'view');
  if (!isUserContext(result)) return result;

  const role = await prisma.role.findUnique({
    where: { id: roleId },
    include: {
      parentRole: { select: { id: true, name: true, slug: true } },
      childRoles: { select: { id: true, name: true, slug: true } },
      permissions: {
        include: {
          permission: {
            include: {
              module: { select: { id: true, name: true, slug: true } },
              action: { select: { id: true, name: true, slug: true } },
            },
          },
        },
      },
      _count: { select: { userRoles: true } },
    },
  });

  if (!role) {
    return NextResponse.json({ success: false, error: 'Role not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true, role });
}

// PATCH /api/admin/roles/[roleId]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ roleId: string }> }
) {
  const { roleId } = await params;
  const result = await requirePermission(request, 'admin', 'edit');
  if (!isUserContext(result)) return result;

  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) {
    return NextResponse.json({ success: false, error: 'Role not found' }, { status: 404 });
  }

  // Full lock — system admin role is completely immutable
  if (role.isSystem && role.slug === 'admin') {
    return NextResponse.json(
      { success: false, error: 'The system admin role cannot be modified' },
      { status: 403 }
    );
  }

  // Protected workflow roles can be renamed/recolored but NOT deactivated
  const body_peek = await request.clone().json().catch(() => ({}));
  if (PROTECTED_ROLE_SLUGS.has(role.slug) && body_peek.isActive === false) {
    return NextResponse.json(
      {
        success: false,
        error: `The '${role.name}' role is a protected system role and cannot be deactivated. It can only be renamed or recolored.`,
      },
      { status: 403 }
    );
  }

  const body = await request.json();
  const parsed = UpdateRoleSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // ─── "Acts As" (legacyRole) change guards ───────────────────────────────────
  const legacyRoleChanged =
    parsed.data.legacyRole !== undefined && parsed.data.legacyRole !== role.legacyRole;

  if (legacyRoleChanged) {
    // Never let a role acquire unrestricted ADMIN access via this field.
    if (parsed.data.legacyRole === 'ADMIN' && role.slug !== 'admin') {
      return NextResponse.json(
        { success: false, error: 'A custom role cannot act as ADMIN.' },
        { status: 403 }
      );
    }
    // System slugs resolve their code from SYSTEM_SLUG_TO_ROLE regardless of the
    // stored column, so a write here would be a silent no-op — reject it loudly.
    if (role.isSystem || role.slug in SYSTEM_SLUG_TO_ROLE) {
      return NextResponse.json(
        {
          success: false,
          error: `The base role of the built-in '${role.name}' role is fixed and cannot be changed.`,
        },
        { status: 403 }
      );
    }
  }

  const updated = await prisma.role.update({
    where: { id: roleId },
    data: {
      ...(parsed.data.name && { name: parsed.data.name }),
      ...(parsed.data.description !== undefined && { description: parsed.data.description }),
      ...(parsed.data.color !== undefined && { color: parsed.data.color }),
      ...(parsed.data.priority !== undefined && { priority: parsed.data.priority }),
      ...(parsed.data.parentRoleId !== undefined && { parentRoleId: parsed.data.parentRoleId }),
      ...(parsed.data.isActive !== undefined && { isActive: parsed.data.isActive }),
      ...(parsed.data.legacyRole !== undefined && { legacyRole: parsed.data.legacyRole }),
      ...(parsed.data.isSubAdmin !== undefined && { isSubAdmin: parsed.data.isSubAdmin }),
    },
  });

  // If deactivated, invalidate all users with this role
  if (parsed.data.isActive === false) {
    const usersWithRole = await prisma.userRoleAssignment.findMany({
      where: { roleId: roleId, isActive: true },
      select: { userId: true },
    });
    await Promise.all(usersWithRole.map((ur) => invalidateUserPermissions(ur.userId)));
  }

  // If the base role changed, re-derive User.role for everyone currently holding
  // this role and drop their permission cache. Their existing JWT still carries
  // the old `role` claim until they re-login (surfaced in the modal's warning).
  if (legacyRoleChanged) {
    const assignments = await prisma.userRoleAssignment.findMany({
      where: { roleId: roleId, isActive: true },
      select: { userId: true },
    });
    for (const { userId } of assignments) {
      await syncUserLegacyRoleFromActiveAssignments(userId);
      await invalidateUserPermissions(userId);
    }
  }

  await prisma.roleAuditLog.create({
    data: {
      actedBy: result.userId,
      action: 'role_updated',
      targetType: 'role',
      targetId: roleId,
      before: role,
      after: updated,
    },
  });

  await bumpMasterDataVersion('roles');
  return NextResponse.json({ success: true, role: updated });
}

// DELETE /api/admin/roles/[roleId]
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ roleId: string }> }
) {
  const { roleId } = await params;
  const result = await requirePermission(request, 'admin', 'delete');
  if (!isUserContext(result)) return result;

  const role = await prisma.role.findUnique({
    where: { id: roleId },
    include: { _count: { select: { userRoles: true } } },
  });

  if (!role) {
    return NextResponse.json({ success: false, error: 'Role not found' }, { status: 404 });
  }

  if (role.isSystem || PROTECTED_ROLE_SLUGS.has(role.slug)) {
    return NextResponse.json(
      { success: false, error: 'System-protected roles cannot be deleted' },
      { status: 403 }
    );
  }

  if (role._count.userRoles > 0) {
    return NextResponse.json(
      {
        success: false,
        error: `Cannot delete role — ${role._count.userRoles} employee(s) are assigned to it. Remove them first.`,
      },
      { status: 409 }
    );
  }

  // Employees whose user.role still carries this role's code without a role
  // assignment row. Only meaningful when no other role shares the same code
  // (several custom roles act as 'FDO', for example).
  const rolesSharingCode = await prisma.role.count({ where: { legacyRole: role.legacyRole } });
  const legacyUsers =
    rolesSharingCode === 1 ? await prisma.user.count({ where: { role: role.legacyRole } }) : 0;
  if (legacyUsers > 0) {
    return NextResponse.json(
      {
        success: false,
        error: `Cannot delete role — ${legacyUsers} employee(s) still have the '${role.legacyRole}' role code. Change their role first.`,
      },
      { status: 409 }
    );
  }

  // Workflows reference roles by slug (no FK), so the DB wouldn't stop the delete —
  // the stage would just silently point at a role that no longer exists.
  const [clientStages, approvalStages, staffLoanStages, belongingItems, childRoles] = await Promise.all([
    prisma.clientWorkflowStage.count({ where: { roleSlug: role.slug } }),
    prisma.approvalStage.count({
      where: { OR: [{ approverRoleSlug: role.slug }, { escalateToRoleSlug: role.slug }] },
    }),
    prisma.staffLoanWorkflowStage.count({ where: { roleId } }),
    prisma.employeeBelongingItem.count({ where: { roleSlug: role.slug, isActive: true } }),
    prisma.role.count({ where: { parentRoleId: roleId } }),
  ]);
  const usages = [
    clientStages > 0 && 'Client Approval workflow',
    approvalStages > 0 && 'Approval workflow stages',
    staffLoanStages > 0 && 'Staff Loan workflow',
    belongingItems > 0 && 'Employee Belongings catalog',
    childRoles > 0 && `parent of ${childRoles} role(s)`,
  ].filter(Boolean);
  if (usages.length > 0) {
    return NextResponse.json(
      {
        success: false,
        error: `Cannot delete role — it is still used in: ${usages.join(', ')}. Remove it from there first.`,
      },
      { status: 409 }
    );
  }

  await prisma.$transaction([
    prisma.role.delete({ where: { id: roleId } }),
    prisma.roleAuditLog.create({
      data: {
        actedBy: result.userId,
        action: 'role_deleted',
        targetType: 'role',
        targetId: roleId,
        before: role,
      },
    }),
  ]);
  await bumpMasterDataVersion('roles');

  return NextResponse.json({ success: true });
}
