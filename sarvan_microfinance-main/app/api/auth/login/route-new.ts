// ============================================================
// NEW LOGIN ROUTE — Refactored for Dynamic RBAC
// app/api/auth/login/route-new.ts
// RENAME THIS TO route.ts when ready to switch
//
// Key changes from old version:
//   - NO UserRole enum
//   - Loads roles dynamically from user_roles table
//   - Embeds permVersion in JWT for cache invalidation
//   - Returns granted permissions array to client
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/prisma';
import {
  generateAccessToken,
  generateRefreshToken,
  comparePassword,
} from '@/app/lib/auth/jwt';
import { getPermissionVersion } from '@/app/lib/permissions/engine';

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = LoginSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid request', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { email, password } = parsed.data;

    const user = await prisma.user.findFirst({
      where: { email: email.toLowerCase() },
      select: {
        id: true,
        email: true,
        password: true,
        firstName: true,
        lastName: true,
        employeeId: true,
        isActive: true,
        branchId: true,
        userRoles: {
          where: { isActive: true },
          include: {
            role: {
              select: { id: true, name: true, slug: true, priority: true, isSystem: true },
            },
          },
        },
        userBranchAccess: {
          where: { isActive: true },
          select: {
            branchId: true,
            accessType: true,
            isPrimary: true,
            branch: { select: { id: true, name: true, code: true, address: true } },
          },
        },
        branch: {
          select: { id: true, name: true, code: true, address: true },
        },
      },
    });

    if (!user || !user.isActive) {
      return NextResponse.json(
        { success: false, error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    const passwordValid = await comparePassword(password, user.password);
    if (!passwordValid) {
      return NextResponse.json(
        { success: false, error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    // Resolve active branch
    const primaryBranch = user.userBranchAccess.find((ba) => ba.isPrimary)?.branch;
    const activeBranch = primaryBranch || user.branch || null;
    const activeBranchId = activeBranch?.id ?? null;

    const isHeadOffice =
      activeBranch?.code?.toUpperCase() === 'HO' ||
      activeBranch?.name?.toLowerCase().includes('head office') ||
      false;

    // Branch lock check for non-system, non-HO users
    if (activeBranchId && !isHeadOffice) {
      const isSystemRole = user.userRoles.some((ur) => ur.role.isSystem);
      if (!isSystemRole) {
        const lock = await prisma.branchLock.findUnique({
          where: { branchId: activeBranchId },
        });
        if (lock) {
          return NextResponse.json(
            { success: false, error: 'Branch is currently locked. Contact HO.' },
            { status: 403 }
          );
        }
      }
    }

    const permVersion = await getPermissionVersion(user.id);

    const jwtPayload = {
      userId: user.id,
      email: user.email ?? '',
      branchId: activeBranchId,
      permVersion,
      isHeadOffice,
    };

    const accessToken = generateAccessToken(jwtPayload);
    const refreshToken = generateRefreshToken(jwtPayload);

    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const roles = user.userRoles.map((ur) => ({
      roleId: ur.role.id,
      roleName: ur.role.name,
      roleSlug: ur.role.slug,
      priority: ur.role.priority,
      branchId: ur.branchId,
    }));

    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        employeeId: user.employeeId,
        isActive: user.isActive,
        roles,
      },
      branch: activeBranch
        ? { id: activeBranch.id, name: activeBranch.name, code: activeBranch.code, isHeadOffice }
        : null,
      accessToken,
      refreshToken,
      permVersion,
    });

    const cookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
    };

    response.cookies.set('accessToken', accessToken, { ...cookieOptions, maxAge: 72 * 60 * 60 });
    response.cookies.set('refreshToken', refreshToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 });
    if (activeBranchId) {
      response.cookies.set('activeBranchId', activeBranchId, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 });
    }

    return response;
  } catch (error) {
    console.error('[Login] Error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
