import { NextRequest } from 'next/server';
import * as z from 'zod';
import { prisma } from '@/app/lib/db';
import { hashPassword, verifyAccessToken } from '@/app/lib/auth';
import { handleCorsPreflight, errorResponse, jsonResponse, successResponse } from '@/app/lib/api-utils';
import { issueMobileSession } from '@/app/lib/services/mobile-session.service';

const mpinChangeSchema = z
  .object({
    mpin: z.string().regex(/^\d{4}$/, 'MPIN must be exactly 4 digits'),
    confirmMpin: z.string().regex(/^\d{4}$/, 'MPIN must be exactly 4 digits'),
  })
  .refine((data) => data.mpin === data.confirmMpin, {
    message: 'MPIN and confirmation do not match',
    path: ['confirmMpin'],
  });

/**
 * @swagger
 * /api/mobile/mpin/change:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Set a new MPIN after an MPIN change request has been approved
 *     description: >
 *       Accepts either token an employee could be holding when their forgot-MPIN
 *       request gets approved: their normal, already-issued mobile session token
 *       (already logged in), OR the short-lived mpinLoginToken from POST
 *       /api/mobile/login (code MPIN_REQUIRED — they forgot MPIN mid-login and never
 *       completed it). Any other purpose-scoped ticket (e.g. mpin_setup) is rejected.
 *       No separate status pre-check — the employee's APPROVED MpinChangeRequest is
 *       looked up AND atomically claimed (flipped to COMPLETED) in the same
 *       conditional update, scoped by employeeId + status: 'APPROVED'. At most one
 *       unconsumed request can exist per employee at a time (enforced in
 *       POST /api/mobile/mpin/forgot), so this unambiguously targets the one usable
 *       request or matches none — no request, PENDING, REJECTED, or an
 *       already-COMPLETED request all fail this same update with zero rows affected.
 *       The claim can never be reused: once COMPLETED here, no request is left in a
 *       claimable state until a new forgot-MPIN request is made and approved. If the
 *       mpinLoginToken was used (login was still incomplete), this call also completes
 *       login and returns the real, non-expiring access/refresh token pair — no
 *       separate /api/mobile/mpin/verify call is needed afterward.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - mpin
 *               - confirmMpin
 *             properties:
 *               mpin:
 *                 type: string
 *                 example: "5678"
 *               confirmMpin:
 *                 type: string
 *                 example: "5678"
 *     responses:
 *       200:
 *         description: MPIN changed (real tokens included if this also completed login)
 *       400:
 *         description: Invalid MPIN format or mismatch
 *       401:
 *         description: Missing/invalid/expired token, or a token not valid for this route
 *       403:
 *         description: No approved MPIN change request (code MPIN_CHANGE_NOT_APPROVED), account inactive, or no branch assigned
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

    // Allowlist: a normal session token (no purpose) or the mid-login mpinLoginToken
    // (mpin_pending) may reach this route — same allowlist as /mpin/verify and
    // /mpin/forgot. mpin_setup is excluded — there is no approved change request to
    // act on before the first MPIN even exists.
    if (payload.purpose !== undefined && payload.purpose !== 'mpin_pending') {
      return errorResponse('Invalid or expired token', 401);
    }
    const isCompletingLogin = payload.purpose === 'mpin_pending';

    const body = await request.json();
    const validationResult = mpinChangeSchema.safeParse(body);
    if (!validationResult.success) {
      return errorResponse(validationResult.error.errors[0]?.message || 'Invalid input', 400);
    }
    const { mpin } = validationResult.data;

    const mpinHash = await hashPassword(mpin);

    // No separate pre-check — the status check IS the update's WHERE clause. At most
    // one non-terminal (PENDING/APPROVED) request ever exists per employee (forgot
    // refuses to create a second one while PENDING, and APPROVED is consumed here in
    // the same atomic step it's checked), so scoping directly by employeeId + status:
    // 'APPROVED' unambiguously targets the one usable request, or none at all. This is
    // also the concurrency guard: a concurrent call or a replayed request can never
    // claim the same approval twice — only the call that wins this conditional update
    // proceeds to change the MPIN, and the claimed request is gone (COMPLETED) for
    // every next call, whether this one succeeds or a future forgot-MPIN request
    // creates a new one.
    const claimedOrNull = await prisma.$transaction(async (tx) => {
      const claimed = await tx.mpinChangeRequest.updateMany({
        where: { employeeId: payload.userId, status: 'APPROVED' },
        data: { status: 'COMPLETED', completedAt: new Date() },
      });
      if (claimed.count === 0) return null;

      await tx.user.update({
        where: { id: payload.userId },
        data: { mpinHash, mpinFailedAttempts: 0, mpinLastFailedAt: null },
      });
      return claimed;
    });

    if (!claimedOrNull) {
      return jsonResponse(
        {
          success: false,
          code: 'MPIN_CHANGE_NOT_APPROVED',
          message: 'No approved MPIN change request found. Please request an MPIN change and wait for administrator approval.',
        },
        403
      );
    }

    if (!isCompletingLogin) {
      // Already fully logged in — just changing MPIN, no new tokens needed.
      return successResponse(null, 'MPIN changed successfully.');
    }

    const session = await issueMobileSession(payload.userId);
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

    return successResponse(session.authData, 'MPIN changed successfully. Login successful.');
  } catch (error) {
    console.error('MPIN change error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Internal server error', 500);
  }
}
