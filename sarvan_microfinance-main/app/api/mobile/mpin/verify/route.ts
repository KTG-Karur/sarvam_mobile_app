import { getLoginBlockReason, LOGIN_BLOCK_MESSAGES } from '@/app/lib/services/login-access.service';
import { NextRequest } from 'next/server';
import * as z from 'zod';
import { prisma } from '@/app/lib/db';
import { verifyAccessToken } from '@/app/lib/auth';
import { handleCorsPreflight, errorResponse, successResponse, jsonResponse } from '@/app/lib/api-utils';
import { MPIN_MAX_ATTEMPTS, verifyEmployeeMpin } from '@/app/lib/services/mpin.service';
import { issueMobileSession } from '@/app/lib/services/mobile-session.service';

const mpinVerifySchema = z.object({
  mpin: z.string().regex(/^\d{4}$/, 'MPIN must be exactly 4 digits'),
});

/**
 * @swagger
 * /api/mobile/mpin/verify:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Verify MPIN — completes login (step 2), or unlocks an already-open session
 *     description: >
 *       Dual-purpose by design, distinguished by which token is presented:
 *         - Presented with the short-lived mpinLoginToken from POST /api/mobile/login
 *           (purpose "mpin_pending") — completes login: on correct MPIN, issues and
 *           returns the real, non-expiring access/refresh token pair.
 *         - Presented with the employee's normal, already-issued mobile access token
 *           (no purpose claim) — this is the app-resume/unlock check. Since mobile
 *           tokens never expire, reopening the app after it was backgrounded should
 *           only ask for the MPIN, never re-collect username/password. On correct
 *           MPIN, returns success with no new tokens — the stored token was already
 *           valid.
 *       Deliberately bypasses withAuth (which rejects any purpose-carrying token) to
 *       allow exactly the mpin_pending case through; every other purpose value,
 *       including mpin_setup, is still rejected. Reads the Authorization header only
 *       (not the accessToken cookie) so a web session can never exercise this
 *       mobile-only route or burn the employee's MPIN attempt counter. Subject to the
 *       same 3-attempt / 60s lockout in both cases, via the same counter.
 *     responses:
 *       200:
 *         description: MPIN verified — real tokens if completing login, none if unlocking a resumed session
 *       401:
 *         description: Missing/invalid/expired token, or a token not valid for this route
 *       403:
 *         description: INVALID_MPIN, MPIN_NOT_SET, account inactive, or no branch assigned
 *       429:
 *         description: MPIN_ATTEMPT_LIMIT — 3 wrong MPIN attempts, retry after retryAfterSeconds.
 */

export async function OPTIONS() {
  return handleCorsPreflight();
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return errorResponse('Authentication required', 401);
    }

    let payload;
    try {
      payload = verifyAccessToken(authHeader.substring(7));
    } catch {
      return errorResponse('Invalid or expired token', 401);
    }

    // Allowlist: only an already-issued normal session token (no purpose) or the
    // login-completion ticket (mpin_pending) may reach this route. Any other purpose
    // — including mpin_setup — is rejected, same as withAuth would reject it elsewhere.
    if (payload.purpose !== undefined && payload.purpose !== 'mpin_pending') {
      return errorResponse('Invalid or expired token', 401);
    }
    const isCompletingLogin = payload.purpose === 'mpin_pending';

    const body = await request.json();
    const validationResult = mpinVerifySchema.safeParse(body);
    if (!validationResult.success) {
      return errorResponse(validationResult.error.errors[0]?.message || 'Invalid input', 400);
    }
    const { mpin } = validationResult.data;

    const dbUser = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, isActive: true, dateOfExit: true, mobileLoginEnabled: true, mpinHash: true, mpinFailedAttempts: true, mpinLastFailedAt: true },
    });

    if (!dbUser) {
      return errorResponse('Employee not found', 404);
    }

    const blockReason = getLoginBlockReason(dbUser, 'MOBILE');
    if (blockReason) {
      return errorResponse(LOGIN_BLOCK_MESSAGES[blockReason], 403);
    }

    if (!dbUser.mpinHash) {
      return jsonResponse(
        { success: false, code: 'MPIN_NOT_SET', message: 'MPIN is not set for this employee.' },
        403
      );
    }

    const result = await verifyEmployeeMpin(
      dbUser.id,
      dbUser.mpinHash,
      dbUser.mpinFailedAttempts,
      dbUser.mpinLastFailedAt,
      mpin
    );

    if (result.status === 'locked' || result.status === 'invalid_limit') {
      return jsonResponse(
        {
          success: false,
          code: 'MPIN_ATTEMPT_LIMIT',
          message: `MPIN verification failed. Please try again after ${result.retryAfterSeconds} seconds.`,
          data: {
            mpinAttempts: result.status === 'invalid_limit' ? result.attempts : MPIN_MAX_ATTEMPTS,
            maxAttempts: MPIN_MAX_ATTEMPTS,
            retryAfterSeconds: result.retryAfterSeconds,
          },
        },
        429
      );
    }

    if (result.status === 'invalid') {
      return jsonResponse(
        {
          success: false,
          code: 'INVALID_MPIN',
          message: 'MPIN verification failed.',
          data: { mpinAttempts: result.attempts, maxAttempts: MPIN_MAX_ATTEMPTS },
        },
        403
      );
    }

    // result.status === 'success'
    if (!isCompletingLogin) {
      // App-resume unlock — the presented token was already a valid session; nothing more to issue.
      return successResponse(null, 'MPIN verified successfully.');
    }

    const session = await issueMobileSession(dbUser.id);
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

    return successResponse(session.authData, 'Login successful.');
  } catch (error) {
    console.error('MPIN verify error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Internal server error', 500);
  }
}
