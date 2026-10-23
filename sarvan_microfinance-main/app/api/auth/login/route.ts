import { getLoginBlockReason, LOGIN_BLOCK_MESSAGES } from '@/app/lib/services/login-access.service';
import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { comparePassword, generateAccessToken, generateRefreshToken } from '@/app/lib/auth';
import {
  ACTIVE_BRANCH_COOKIE_NAME,
  getActiveBranchCookieOptions,
} from '@/app/lib/branch-session';
import { AuthResponse } from '@/app/types';
import { handleCorsPreflight, errorResponse, successResponse } from '@/app/lib/api-utils';
import * as z from 'zod';
import { getAreaManagerBranchIds } from '@/app/lib/am-branch-utils';
import { getUserAssignedBranchIds } from '@/app/lib/user-branch-assignments';
import { resolveOrgScopedHomeBranchId } from '@/app/lib/permissions/org-scope';
import { isHeadOfficeBranch } from '@/app/lib/head-office-branch';
import { getClientIp, recordUserLogin } from '@/app/lib/services/user-activity-tracker';

const loginSchema = z.object({
  employeeId: z.string().min(1, 'Employee ID is required'),
  password: z.string().min(1, 'Password is required').min(6, 'Password must be at least 6 characters'),
});

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: User Login
 *     description: Authenticate a user with email and password. Returns JWT tokens and user details.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 format: email
 *                 example: admin@k3microfinance.com
 *                 description: User's email address
 *               password:
 *                 type: string
 *                 minLength: 6
 *                 example: password123
 *                 description: User's password (minimum 6 characters)
 *     responses:
 *       200:
 *         description: Login successful
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
 *         description: Invalid credentials
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Error'
 *       403:
 *         description: Account is inactive
 */

// Handle CORS preflight requests
export async function OPTIONS() {
  return handleCorsPreflight();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validationResult = loginSchema.safeParse(body);

    if (!validationResult.success) {
      const firstError = validationResult.error.errors[0];
      return errorResponse(firstError?.message || 'Invalid input', 400);
    }

    const { employeeId, password } = validationResult.data;

    // Find user in database with branch information.
    // For AREA_MANAGER, also load the primary branch from the junction table.
    const user = await prisma.user.findUnique({
      where: { employeeId },
      include: {
        branch: {
          select: {
            id: true,
            name: true,
            code: true,
            address: true,
          },
        },
        // Include the AM's primary branch assignment (if any)
        areaManagerBranches: {
          orderBy: [
            { isPrimary: 'desc' },
            { createdAt: 'asc' }
          ],
          take: 1,
          include: {
            branch: {
              select: {
                id: true,
                name: true,
                code: true,
                address: true,
              },
            },
          },
        },
        // Include active RBAC role so frontend can detect custom roles
        userRoles: {
          where: { isActive: true },
          select: {
            role: { select: { slug: true, name: true, isSubAdmin: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!user) {
      return errorResponse('Invalid Employee ID or password', 401);
    }

    const blockReason = getLoginBlockReason(user, 'WEB');
    if (blockReason) {
      return errorResponse(LOGIN_BLOCK_MESSAGES[blockReason], 403);
    }

    // Verify password
    const isPasswordValid = await comparePassword(password, user.password);
    if (!isPasswordValid) {
      return errorResponse('Invalid Employee ID or password', 401);
    }

    // Branch lock (write-window) intentionally does NOT gate login — it only gates
    // actual mutations (see assertBranchNotLocked, used by collections/disbursements/
    // denomination-entry/etc.). BM/FDO/AM must always be able to log in and view data,
    // even outside the branch's working hours or after EOD has closed for the day.

    // ─── Resolve default branch for this login session ──────────────────────────
    // ADMIN       → always starts at Head Office
    // AREA_MANAGER→ starts at their primary branch (from junction table)
    //               if no junction row yet, falls back gracefully
    // BM / FDO    → user.branch (their single home branch)
    let defaultBranchForLogin: {
      id: string;
      name: string;
      code: string;
      address: string | null;
    } | null = null;

    if (user.role === 'ADMIN') {
      defaultBranchForLogin = await prisma.branch.findFirst({
        where: {
          OR: [
            { code: 'HO' },
            { name: { equals: 'Head Office', mode: 'insensitive' } },
          ],
        },
        select: { id: true, name: true, code: true, address: true },
      });
    } else if (user.role === 'AREA_MANAGER') {
      // Primary branch from junction table; falls back to the home branch
      // column when no junction row exists yet (freshly role-granted AMs) —
      // 403 below still fires when the user genuinely has neither.
      const primaryAssignment = user.areaManagerBranches[0];
      defaultBranchForLogin = primaryAssignment?.branch ?? user.branch;
    } else {
      defaultBranchForLogin = user.branch;
      // Region / Division / Area coverage (UserOrgScope): start in a covered branch
      // rather than Head Office, which would read as "unrestricted".
      const scopedHomeId = await resolveOrgScopedHomeBranchId(user.id, defaultBranchForLogin?.id ?? null);
      if (scopedHomeId && scopedHomeId !== defaultBranchForLogin?.id) {
        defaultBranchForLogin = await prisma.branch.findUnique({
          where: { id: scopedHomeId },
          select: { id: true, name: true, code: true, address: true },
        });
      }
    }

    if (!defaultBranchForLogin && user.role !== 'ADMIN') {
      return errorResponse(
        'No active branch assigned to your account. Please contact your Administrator to assign a branch.',
        403
      );
    }
    // ────────────────────────────────────────────────────────────────────────────

    // This response's `branch.isHeadOffice` is the ONLY place the client-side
    // isHeadOffice flag (useAuthStore / usePermission()) is ever populated —
    // it was previously omitted here entirely, so every login silently fell
    // back to `false` regardless of role or branch, incorrectly narrowing any
    // UI that widens its branch list for Head Office users (e.g. the HR
    // onboarding "Branch / Location" picker, which then only showed the
    // caller's own assigned branch instead of every branch).
    const defaultBranchIsHeadOffice = defaultBranchForLogin
      ? await isHeadOfficeBranch(defaultBranchForLogin.id)
      : false;

    // Fetch all assigned branch IDs (embedded in JWT for client-side guards and
    // to avoid a DB round-trip per request). AREA_MANAGER uses AreaManagerBranch;
    // every other role uses UserBranchAssignment — most users have zero rows there
    // (never explicitly multi-branch-assigned), in which case this stays empty and
    // the payload below omits the claim entirely, preserving single-branch behavior.
    const assignedBranchIds =
      user.role === 'AREA_MANAGER'
        ? await getAreaManagerBranchIds(user.id)
        : await getUserAssignedBranchIds(user.id);

    // Generate tokens
    const payload = {
      userId: user.id,
      email: user.email ?? '',
      role: user.role,
      branchId: defaultBranchForLogin?.id || undefined,
      ...(assignedBranchIds && assignedBranchIds.length > 0
        ? { assignedBranchIds }
        : {}),
    };

    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    // Save refresh token to database
    await prisma.refreshToken.create({
      data: {
        token: refreshToken,
        userId: user.id,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      },
    });

    recordUserLogin({
      userId: user.id,
      platform: 'WEB',
      branchId: defaultBranchForLogin?.id ?? null,
      ipAddress: getClientIp(request.headers),
      deviceName: request.headers.get('user-agent')?.slice(0, 255) ?? null,
    });

    // Prepare response data — mpinHash/attempt-tracking fields must never leave this server.
    const {
      password: _,
      mpinHash: _mpinHash,
      mpinFailedAttempts: _mpinFailedAttempts,
      mpinLastFailedAt: _mpinLastFailedAt,
      branch,
      areaManagerBranches,
      userRoles,
      ...userWithoutPassword
    } = user;
    const rbacRoleSlug = userRoles[0]?.role?.slug ?? null;
    const rbacRoleName = userRoles[0]?.role?.name ?? null;   // human-readable role name for UI display
    const isSubAdmin = userRoles[0]?.role?.isSubAdmin ?? false;
    const authData: AuthResponse = {
      user: { ...userWithoutPassword, email: userWithoutPassword.email ?? '', assignedBranchIds, rbacRoleSlug, rbacRoleName, isSubAdmin },
      accessToken,
      refreshToken,
      branch: defaultBranchForLogin
        ? { ...defaultBranchForLogin, isHeadOffice: defaultBranchIsHeadOffice }
        : undefined,
    };

    const response = successResponse(authData);

    // Set cookies for web compatibility
    response.cookies.set('accessToken', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 72 * 60 * 60,
    });

    response.cookies.set('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60,
    });

    if (payload.branchId) {
      response.cookies.set(
        ACTIVE_BRANCH_COOKIE_NAME,
        payload.branchId,
        getActiveBranchCookieOptions()
      );
    } else {
      response.cookies.delete(ACTIVE_BRANCH_COOKIE_NAME);
    }

    return response;
  } catch (error) {
    console.error('Login error:', error);

    if (error instanceof z.ZodError) {
      const firstError = error.errors[0];
      return errorResponse(firstError?.message || 'Invalid input', 400);
    }

    return errorResponse(
      error instanceof Error ? error.message : 'Internal server error',
      500
    );
  }
}

