import { getLoginBlockReason, LOGIN_BLOCK_MESSAGES } from '@/app/lib/services/login-access.service';
import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { verifyRefreshToken, generateAccessToken, generateRefreshToken } from '@/app/lib/auth';
import { getAreaManagerBranchIds } from '@/app/lib/am-branch-utils';
import { getUserAssignedBranchIds } from '@/app/lib/user-branch-assignments';
import { resolveOrgScopedHomeBranchId } from '@/app/lib/permissions/org-scope';
import { AuthResponse } from '@/app/types';
import { handleCorsPreflight, errorResponse, successResponse } from '@/app/lib/api-utils';
import { isHeadOfficeBranch } from '@/app/lib/head-office-branch';

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Refresh Access Token
 *     description: Get a new access token using a valid refresh token. Used when the access token expires.
 *     security: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refreshToken:
 *                 type: string
 *                 description: Valid refresh token (optional if using cookies)
 *     responses:
 *       200:
 *         description: Token refreshed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 data:
 *                   $ref: '#/components/schemas/AuthResponse'
 *       401:
 *         description: Invalid or expired refresh token
 *       403:
 *         description: Account is inactive
 */

export async function OPTIONS() {
  return handleCorsPreflight();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const incomingRefreshToken = body.refreshToken || request.cookies.get('refreshToken')?.value;

    if (!incomingRefreshToken) {
      return errorResponse('Refresh token not found', 401);
    }

    // Verify token signature
    let payload;
    try {
      payload = verifyRefreshToken(incomingRefreshToken);
    } catch {
      return errorResponse('Invalid refresh token', 401);
    }

    // Check token in database
    const tokenRecord = await prisma.refreshToken.findUnique({
      where: { token: incomingRefreshToken },
      include: {
        user: {
          include: {
            branch: {
              select: {
                id: true,
                name: true,
                code: true,
                address: true,
              }
            },
            // Include active RBAC role so the refreshed session shows the correct role name
            userRoles: {
              where: { isActive: true },
              select: {
                role: { select: { slug: true, name: true, isSubAdmin: true } },
              },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          }
        }
      },
    });

    if (!tokenRecord || tokenRecord.expiresAt < new Date()) {
      return errorResponse('Refresh token expired or invalid', 401);
    }
    if (payload.userId !== tokenRecord.userId) {
      return errorResponse('Invalid refresh token payload', 401);
    }

    const blockReason = getLoginBlockReason(tokenRecord.user, 'WEB');
    if (blockReason) {
      return errorResponse(LOGIN_BLOCK_MESSAGES[blockReason], 403);
    }

    // Generate fresh tokens with full branch-aware payload
    // Re-embed the assigned-branch list (same source as login) — without it,
    // getAuthenticatedUser ignores the active-branch cookie and a multi-branch
    // user is silently pinned back to their primary branch after every refresh.
    const assignedBranchIds =
      tokenRecord.user.role === 'AREA_MANAGER'
        ? await getAreaManagerBranchIds(tokenRecord.user.id)
        : await getUserAssignedBranchIds(tokenRecord.user.id);
    const newPayload = {
      userId: tokenRecord.user.id,
      email: tokenRecord.user.email ?? '',
      role: tokenRecord.user.role,
      // Same Region / Division / Area coverage rule as login (never parked at HO).
      branchId:
        (tokenRecord.user.role === 'ADMIN' || tokenRecord.user.role === 'AREA_MANAGER'
          ? tokenRecord.user.branchId
          : await resolveOrgScopedHomeBranchId(tokenRecord.user.id, tokenRecord.user.branchId)) || undefined,
      ...(assignedBranchIds.length > 0 ? { assignedBranchIds } : {}),
      // Keep the client marker so a refreshed mobile session is still tracked as MOBILE.
      ...(payload.platform ? { platform: payload.platform } : {}),
    };
    const newAccessToken = generateAccessToken(newPayload);
    const newRefreshToken = generateRefreshToken(newPayload);

    // Rotate refresh token for better session security and long-lived stability
    await prisma.$transaction([
      prisma.refreshToken.deleteMany({
        where: { token: incomingRefreshToken },
      }),
      prisma.refreshToken.create({
        data: {
          token: newRefreshToken,
          userId: tokenRecord.user.id,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        }
      })
    ]);

    // Prepare user data — mpinHash/attempt-tracking fields must never leave this server.
    const {
      password: _,
      mpinHash: _mpinHash,
      mpinFailedAttempts: _mpinFailedAttempts,
      mpinLastFailedAt: _mpinLastFailedAt,
      branch,
      userRoles: refreshUserRoles,
      ...userWithoutPassword
    } = tokenRecord.user as typeof tokenRecord.user & { userRoles?: { role: { slug: string; name: string; isSubAdmin: boolean } }[] };
    const rbacRoleSlug = refreshUserRoles?.[0]?.role?.slug ?? null;
    const rbacRoleName = refreshUserRoles?.[0]?.role?.name ?? null;
    const isSubAdmin = refreshUserRoles?.[0]?.role?.isSubAdmin ?? false;

    const branchIsHeadOffice = branch ? await isHeadOfficeBranch(branch.id) : false;

    const authData: AuthResponse = {
      user: { ...userWithoutPassword, rbacRoleSlug, rbacRoleName, isSubAdmin } as typeof authData.user,
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      branch: branch ? { ...branch, isHeadOffice: branchIsHeadOffice } : undefined,
    };

    const response = successResponse(authData);

    // Set cookie for web compatibility
    response.cookies.set('accessToken', newAccessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 72 * 60 * 60,
    });

    response.cookies.set('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60,
    });

    return response;
  } catch (error) {
    console.error('Refresh token error:', error);
    return errorResponse(
      error instanceof Error ? error.message : 'Internal server error',
      500
    );
  }
}

