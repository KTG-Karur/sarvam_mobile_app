import { NextRequest } from 'next/server';
import * as z from 'zod';
import { prisma } from '@/app/lib/db';
import { hashPassword, verifyAccessToken } from '@/app/lib/auth';
import { handleCorsPreflight, errorResponse, successResponse } from '@/app/lib/api-utils';
import { issueMobileSession } from '@/app/lib/services/mobile-session.service';

const mpinSetupSchema = z
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
 * /api/mobile/mpin/setup:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Create the employee's first mobile MPIN
 *     description: >
 *       Completes first-time mobile MPIN setup AND completes login in the same call.
 *       Authenticated with the short-lived mpinSetupToken returned by POST
 *       /api/mobile/login when the employee has no MPIN yet (code MPIN_NOT_SET) — not a
 *       normal access token. On success, issues and returns the real, non-expiring
 *       access/refresh token pair directly — no separate /api/mobile/mpin/verify call
 *       is needed for a first-time setup.
 *     security: []
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
 *                 example: "1234"
 *               confirmMpin:
 *                 type: string
 *                 example: "1234"
 *     responses:
 *       200:
 *         description: MPIN created and login completed — real access/refresh tokens returned
 *       400:
 *         description: Invalid MPIN format or mismatch
 *       401:
 *         description: Missing/invalid/expired setup token
 *       403:
 *         description: Account inactive or no branch assigned
 *       404:
 *         description: Employee not found
 *       409:
 *         description: MPIN already configured for this employee
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
      return errorResponse('Invalid or expired setup token', 401);
    }

    // Allow mpin_setup, mpin_pending, or valid session tokens so employees can set
    // or reset their MPIN during login or forgot-MPIN flows.
    if (payload.purpose !== undefined && payload.purpose !== 'mpin_setup' && payload.purpose !== 'mpin_pending') {
      return errorResponse('Invalid or expired setup token', 401);
    }

    const body = await request.json();
    const validationResult = mpinSetupSchema.safeParse(body);
    if (!validationResult.success) {
      return errorResponse(validationResult.error.errors[0]?.message || 'Invalid input', 400);
    }
    const { mpin } = validationResult.data;

    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user) {
      return errorResponse('Employee not found', 404);
    }

    const mpinHash = await hashPassword(mpin);

    await prisma.user.update({
      where: { id: user.id },
      data: { mpinHash, mpinFailedAttempts: 0, mpinLastFailedAt: null },
    });

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

    return successResponse(session.authData, 'MPIN created successfully. Login successful.');
  } catch (error) {
    console.error('MPIN setup error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Internal server error', 500);
  }
}
