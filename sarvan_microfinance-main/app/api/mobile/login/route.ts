import { getLoginBlockReason, LOGIN_BLOCK_MESSAGES } from '@/app/lib/services/login-access.service';
import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { comparePassword, generateAccessToken } from '@/app/lib/auth';
import { handleCorsPreflight, errorResponse, jsonResponse, successResponse } from '@/app/lib/api-utils';
import * as z from 'zod';
import { getAreaManagerBranchIds } from '@/app/lib/am-branch-utils';
import { issueMobileSession } from '@/app/lib/services/mobile-session.service';

const mobileLoginSchema = z.object({
  employeeId: z.string().min(1, 'Employee ID is required'),
  password: z.string().min(1, 'Password is required').min(6, 'Password must be at least 6 characters'),
  deviceId: z.string().min(1, 'Device ID is required'),
  deviceName: z.string().optional(),
});

/**
 * FDO accounts that complete login in a single step — credentials only, no MPIN,
 * no device binding — so the mobile app goes straight from Login to the FDO home
 * (e.g. the Play Store review account). The password is still verified against
 * the DB like every other login. Comma-separated employee IDs; defaults to P001.
 */
const DIRECT_LOGIN_EMPLOYEE_IDS = new Set(
  (process.env.MOBILE_DIRECT_LOGIN_EMPLOYEE_IDS ?? 'P001')
    .split(',')
    .map((id) => id.trim().toUpperCase())
    .filter(Boolean)
);

/**
 * @swagger
 * /api/mobile/login:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Mobile App Login — step 1 of 2 (credentials + device only)
 *     description: >
 *       Verifies credentials, employee status, and mobile device binding (order:
 *       credentials → status → device). Does NOT accept or check an MPIN and never
 *       issues a real session token — this route only ever returns a short-lived
 *       purpose-scoped ticket for step 2, plus a non-sensitive employee preview
 *       (id, employeeId, firstName, lastName, role, profilePhotoUrl — never
 *       password/MPIN) so the app can greet the employee on the MPIN screen:
 *         - No MPIN created yet → code MPIN_NOT_SET + mpinSetupToken + user, for
 *           POST /api/mobile/mpin/setup (which now also completes login on success).
 *         - MPIN exists → code MPIN_REQUIRED + mpinLoginToken + user, for
 *           POST /api/mobile/mpin/verify (which completes login on success).
 *       This split lets the mobile app resume an already-logged-in session (its stored
 *       token never expires) by calling mpin/verify directly with that stored token —
 *       without ever re-collecting username/password — while a fresh login (no stored
 *       token, or the employee signed out) must go through this route first.
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - employeeId
 *               - password
 *               - deviceId
 *             properties:
 *               employeeId:
 *                 type: string
 *               password:
 *                 type: string
 *                 minLength: 6
 *               deviceId:
 *                 type: string
 *     responses:
 *       401:
 *         description: Invalid credentials
 *       403:
 *         description: >
 *           Account inactive, device mismatch/already claimed, no branch assigned,
 *           MPIN_NOT_SET (with mpinSetupToken), or MPIN_REQUIRED (with mpinLoginToken).
 */

// Handle CORS preflight requests
export async function OPTIONS() {
  return handleCorsPreflight();
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validationResult = mobileLoginSchema.safeParse(body);

    if (!validationResult.success) {
      const firstError = validationResult.error.errors[0];
      return errorResponse(firstError?.message || 'Invalid input', 400);
    }

    const { employeeId, password, deviceId } = validationResult.data;

    const user = await prisma.user.findUnique({ where: { employeeId } });

    if (!user) {
      return errorResponse('Invalid Employee ID or password', 401);
    }

    const blockReason = getLoginBlockReason(user, 'MOBILE');
    if (blockReason) {
      return errorResponse(LOGIN_BLOCK_MESSAGES[blockReason], 403);
    }

    // Verify password
    const isPasswordValid = await comparePassword(password, user.password);
    if (!isPasswordValid) {
      return errorResponse('Invalid Employee ID or password', 401);
    }

    const deviceName = body.deviceName || 'Mobile Device';

    // ─── Direct-login FDO: credentials are the only factor ──────────────────────
    if (user.role === 'FDO' && DIRECT_LOGIN_EMPLOYEE_IDS.has((user.employeeId ?? '').toUpperCase())) {
      const session = await issueMobileSession(user.id);
      if (!session.ok) {
        if (session.reason === 'NO_BRANCH') {
          return errorResponse(
            'No active branch assigned to your account. Please contact your Administrator to assign a branch.',
            403
          );
        }
        if (session.reason === 'INACTIVE') {
          return errorResponse('Account is inactive. Please contact administrator.', 403);
        }
        return errorResponse('Employee not found', 404);
      }
      await prisma.deviceLoginHistory.create({
        data: {
          userId: user.id,
          employeeId: user.employeeId ?? '',
          deviceId,
          deviceName,
          adminApprovalStatus: 'DIRECT_LOGIN',
        },
      });
      return successResponse({ ...session.authData, directLogin: true }, 'Login successful.');
    }
    // ────────────────────────────────────────────────────────────────────────────

    // ─── Mobile device binding & Single Device Access Control ─────────────────
    if (!user.mobileDeviceId) {
      // First time device binding
      await prisma.user.updateMany({
        where: { mobileDeviceId: deviceId, id: { not: user.id } },
        data: { mobileDeviceId: null },
      });
      await prisma.user.update({
        where: { id: user.id },
        data: { mobileDeviceId: deviceId },
      });
      await prisma.deviceLoginHistory.create({
        data: {
          userId: user.id,
          employeeId: user.employeeId ?? '',
          deviceId,
          deviceName,
          adminApprovalStatus: 'AUTO_BOUND',
        },
      });
    } else if (user.mobileDeviceId !== deviceId) {
      // Different device trying to log in! Check for Admin approval request.
      const approvedReq = await prisma.deviceAccessRequest.findFirst({
        where: {
          userId: user.id,
          deviceId: deviceId,
          status: 'APPROVED',
        },
        orderBy: { updatedAt: 'desc' },
      });

      if (approvedReq) {
        // Device swap approved by Admin! Invalidate old session/tokens & close old history
        await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
        await prisma.deviceLoginHistory.updateMany({
          where: { userId: user.id, logoutAt: null },
          data: { logoutAt: new Date() },
        });

        await prisma.user.updateMany({
          where: { mobileDeviceId: deviceId, id: { not: user.id } },
          data: { mobileDeviceId: null },
        });

        await prisma.user.update({
          where: { id: user.id },
          data: { mobileDeviceId: deviceId },
        });

        await prisma.deviceAccessRequest.update({
          where: { id: approvedReq.id },
          data: { status: 'COMPLETED' },
        });

        await prisma.deviceLoginHistory.create({
          data: {
            userId: user.id,
            employeeId: user.employeeId ?? '',
            deviceId,
            deviceName,
            adminApprovalStatus: 'APPROVED_BY_ADMIN',
          },
        });
      } else {
        // Block login! Check if request is already PENDING
        const pendingReq = await prisma.deviceAccessRequest.findFirst({
          where: {
            userId: user.id,
            deviceId: deviceId,
            status: 'PENDING',
          },
        });

        return jsonResponse(
          {
            success: false,
            code: 'DEVICE_ACCESS_DENIED',
            error:
              'Access Denied\nThis account is already registered on another device. Please contact the Admin to get access on this device.',
            message:
              'Access Denied\nThis account is already registered on another device. Please contact the Admin to get access on this device.',
            data: {
              canRequestAccess: true,
              hasPendingRequest: Boolean(pendingReq),
              employeeId: user.employeeId,
              deviceId,
            },
          },
          403
        );
      }
    } else {
      // Same registered device — create login history entry if none active
      const activeHistory = await prisma.deviceLoginHistory.findFirst({
        where: { userId: user.id, deviceId: deviceId, logoutAt: null },
      });
      if (!activeHistory) {
        await prisma.deviceLoginHistory.create({
          data: {
            userId: user.id,
            employeeId: user.employeeId ?? '',
            deviceId,
            deviceName,
            adminApprovalStatus: 'DIRECT_LOGIN',
          },
        });
      }
    }
    // ────────────────────────────────────────────────────────────────────────────

    // ─── Fail fast if the employee has no branch to log into ────────────────────
    // A real session is never issued from this route, but checking this early avoids
    // handing out an MPIN ticket to someone who'd only hit this same wall at step 2.
    if (user.role === 'AREA_MANAGER') {
      const assignedBranchIds = await getAreaManagerBranchIds(user.id);
      if (assignedBranchIds.length === 0) {
        return errorResponse(
          'No active branch assigned to your account. Please contact your Administrator to assign a branch.',
          403
        );
      }
    } else if (user.role !== 'ADMIN' && !user.branchId) {
      return errorResponse(
        'No active branch assigned to your account. Please contact your Administrator to assign a branch.',
        403
      );
    }
    // ────────────────────────────────────────────────────────────────────────────

    // ─── Hand off to step 2 (MPIN) — never issue a real session from this route ──
    // A safe, non-sensitive subset of the employee's own profile is echoed back here
    // so the mobile app can render "Hi, <name>" on the MPIN screen without yet holding
    // a real session token. Never includes password/mpinHash or anything from other
    // employees — this row was already looked up by this employee's own credentials.
    const employeePreview = {
      id: user.id,
      employeeId: user.employeeId,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      profilePhotoUrl: user.profilePhotoUrl,
    };

    if (!user.mpinHash) {
      const mpinSetupToken = generateAccessToken(
        { userId: user.id, email: user.email ?? '', role: user.role, purpose: 'mpin_setup' },
        '10m'
      );
      return jsonResponse(
        {
          success: false,
          code: 'MPIN_NOT_SET',
          message: 'MPIN is not set. Please create a new 4-digit MPIN.',
          data: { requiresMpinSetup: true, mpinSetupToken, user: employeePreview },
        },
        403
      );
    }

    const mpinLoginToken = generateAccessToken(
      { userId: user.id, email: user.email ?? '', role: user.role, purpose: 'mpin_pending' },
      '10m'
    );
    return jsonResponse(
      {
        success: false,
        code: 'MPIN_REQUIRED',
        message: 'Please enter your MPIN to complete login.',
        data: { mpinRequired: true, mpinLoginToken, user: employeePreview },
      },
      403
    );
  } catch (error) {
    console.error('Mobile login error:', error);

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
