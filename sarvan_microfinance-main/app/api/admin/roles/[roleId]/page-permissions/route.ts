// PAGE PERMISSIONS API
// app/api/admin/roles/[roleId]/page-permissions/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/prisma';
import { cookies } from 'next/headers';
import { verifyAccessToken } from '@/app/lib/auth/jwt';

// ── Schema ───────────────────────────────────────────────────
const PageActionsSchema = z.object({
  view:    z.boolean().default(false),
  add:     z.boolean().default(false),
  edit:    z.boolean().default(false),
  delete:  z.boolean().default(false),
  approve: z.boolean().default(false),
});

const SaveSchema = z.object({
  pagePermissions: z.record(z.string(), PageActionsSchema),
});

// Simple auth: just verify the JWT and return userId
async function getAuthUserId(request: NextRequest): Promise<string | null> {
  try {
    const cookieStore = await cookies();
    const token =
      cookieStore.get('accessToken')?.value ||
      request.headers.get('Authorization')?.replace('Bearer ', '');
    if (!token) return null;
    const payload = verifyAccessToken(token);
    return payload?.userId ?? null;
  } catch {
    return null;
  }
}

// ── GET ───────────────────────────────────────────────────────
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ roleId: string }> }
) {
  try {
    const { roleId } = await params;
    const userId = await getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const role = await prisma.role.findUnique({
      where: { id: roleId },
      select: { id: true, name: true, slug: true, pagePermissions: true },
    });
    if (!role) {
      return NextResponse.json({ success: false, error: 'Role not found' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      pagePermissions: role.pagePermissions ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[GET page-permissions]', msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// ── POST ──────────────────────────────────────────────────────
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ roleId: string }> }
) {
  try {
    const { roleId } = await params;
    const userId = await getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = SaveSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // Check role exists
    const role = await prisma.role.findUnique({
      where: { id: roleId },
      select: { id: true, name: true },
    });
    if (!role) {
      return NextResponse.json({ success: false, error: 'Role not found' }, { status: 404 });
    }

    // Use raw SQL to update JSON field — avoids any Prisma type-casting issues
    const jsonValue = JSON.stringify(parsed.data.pagePermissions);
    await prisma.$executeRawUnsafe(
      `UPDATE roles SET "pagePermissions" = $1::jsonb, "updatedAt" = NOW() WHERE id = $2`,
      jsonValue,
      roleId
    );

    // Audit log (best-effort — don't fail the request if this errors)
    try {
      const allowedCount = Object.values(parsed.data.pagePermissions).filter(
        (a) => a.view
      ).length;
      await prisma.roleAuditLog.create({
        data: {
          actedBy: userId,
          action: 'page_permissions_updated',
          targetType: 'role',
          targetId: roleId,
          after: JSON.parse(JSON.stringify({
            roleId,
            roleName: role.name,
            totalPages: Object.keys(parsed.data.pagePermissions).length,
            pagesWithView: allowedCount,
          })),
        },
      });
    } catch (auditErr) {
      console.warn('[page-permissions] audit log failed:', auditErr);
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[POST page-permissions]', msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

// ── DELETE ────────────────────────────────────────────────────
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ roleId: string }> }
) {
  try {
    const { roleId } = await params;
    const userId = await getAuthUserId(request);
    if (!userId) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    await prisma.$executeRawUnsafe(
      `UPDATE roles SET "pagePermissions" = NULL, "updatedAt" = NOW() WHERE id = $1`,
      roleId
    );

    return NextResponse.json({
      success: true,
      message: 'Page permissions cleared — role now uses default allowedRoles config',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[DELETE page-permissions]', msg);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
