// ============================================================
// ROLE MANAGEMENT API — Create/List Roles
// app/api/admin/roles/route.ts
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/prisma';
import { requirePermission, isUserContext } from '@/app/lib/permissions/guards';
import { invalidateUserPermissions } from '@/app/lib/permissions/engine';
import { computeRoleCode } from '@/app/lib/rbac-role-sync';
import { bumpMasterDataVersion } from '@/app/lib/cache/master-data-cache';

const CreateRoleSchema = z.object({
  name: z.string().min(2).max(100),
  slug: z.string().min(2).max(100).regex(/^[a-z0-9-]+$/),
  // Form sends null for an empty description (and to clear it on edit)
  description: z.string().nullable().optional(),
  color: z.string().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  parentRoleId: z.string().optional(),
  isActive: z.boolean().optional(),
  /**
   * Optional role code stored on user.role in DB and JWT.
   * When omitted, auto-computed from `name` via computeRoleCode().
   * System roles pass their exact value (ADMIN, BRANCH_MANAGER, FDO, AREA_MANAGER).
   */
  legacyRole: z.string().optional(),
  /** Grants final client-approval actions (like ADMIN), scoped to final approval only. */
  isSubAdmin: z.boolean().optional(),
});

// GET /api/admin/roles — List all roles
export async function GET(request: NextRequest) {
  const result = await requirePermission(request, 'admin', 'view');
  if (!isUserContext(result)) return result;

  const roles = await prisma.role.findMany({
    include: {
      _count: {
        select: {
          userRoles: true,       // UserRoleAssignment count (field name on Role model)
          permissions: true,     // RolePermission count
        },
      },
      parentRole: { select: { id: true, name: true } },
      childRoles: { select: { id: true, name: true } },
    },
    orderBy: [{ priority: 'desc' }, { name: 'asc' }],
  });

  return NextResponse.json({ success: true, roles });
}

// POST /api/admin/roles — Create role
export async function POST(request: NextRequest) {
  const result = await requirePermission(request, 'admin', 'create');
  if (!isUserContext(result)) return result;

  const body = await request.json();
  const parsed = CreateRoleSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Check slug uniqueness
  const existing = await prisma.role.findUnique({
    where: { slug: parsed.data.slug },
  });

  if (existing) {
    return NextResponse.json(
      { success: false, error: `Role slug '${parsed.data.slug}' already exists` },
      { status: 409 }
    );
  }

  // A role may not grant itself unrestricted ADMIN access through the "Acts As"
  // field — that escalation path is reserved for the seeded system admin role.
  if (parsed.data.legacyRole === 'ADMIN') {
    return NextResponse.json(
      { success: false, error: 'A custom role cannot act as ADMIN.' },
      { status: 403 }
    );
  }

  // Auto-compute role code from name when admin doesn't specify one explicitly.
  // e.g. "Background Verification Team" → "BVT", "Pune" → "PUNE"
  const legacyRole = parsed.data.legacyRole ?? computeRoleCode(parsed.data.name);

  const role = await prisma.role.create({
    data: {
      name: parsed.data.name,
      slug: parsed.data.slug,
      description: parsed.data.description,
      color: parsed.data.color,
      priority: parsed.data.priority ?? 0,
      parentRoleId: parsed.data.parentRoleId,
      isActive: parsed.data.isActive ?? true,
      legacyRole,
      isSubAdmin: parsed.data.isSubAdmin ?? false,
    },
  });

  // Audit log
  await prisma.roleAuditLog.create({
    data: {
      actedBy: result.userId,
      action: 'role_created',
      targetType: 'role',
      targetId: role.id,
      after: role,
    },
  });

  await bumpMasterDataVersion('roles');
  return NextResponse.json({ success: true, role }, { status: 201 });
}
