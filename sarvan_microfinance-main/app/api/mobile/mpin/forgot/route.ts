import { getLoginBlockReason, LOGIN_BLOCK_MESSAGES } from '@/app/lib/services/login-access.service';
import { NextRequest } from 'next/server';
import * as z from 'zod';
import { prisma } from '@/app/lib/db';
import { verifyAccessToken } from '@/app/lib/auth';
import { handleCorsPreflight, errorResponse, jsonResponse, successResponse } from '@/app/lib/api-utils';

const mpinForgotSchema = z.object({
  deviceId: z.string().min(1, 'Device ID is required'),
});

/**
 * @swagger
 * /api/mobile/mpin/forgot:
 *   post:
 *     tags:
 *       - Authentication
 *     summary: Request a mobile MPIN change (forgot MPIN)
 *     description: >
 *       Accepts either token an employee could plausibly be holding when they tap
 *       "Forgot MPIN": their normal, already-issued mobile session token (resume/already
 *       logged in), OR the short-lived mpinLoginToken from POST /api/mobile/login (code
 *       MPIN_REQUIRED — mid fresh-login, MPIN exists but they can't recall it and haven't
 *       completed login yet). Any other purpose-scoped ticket (e.g. mpin_setup — there is
 *       no MPIN to forget yet in that case) is rejected. Creates a PENDING
 *       MpinChangeRequest for Admin/Sub Admin review — blocked (code
 *       MPIN_CHANGE_REQUEST_PENDING) if the employee already has an unconsumed PENDING
 *       or APPROVED request, so at most one usable request ever exists at a time; a new
 *       request can only be created after the current one is REJECTED or COMPLETED
 *       (i.e. actually used via POST /api/mobile/mpin/change). Never changes, clears,
 *       or nulls the current MPIN — it stays active until an admin approves the
 *       request AND the employee successfully sets a new MPIN.
 *     responses:
 *       200:
 *         description: Request submitted
 *       409:
 *         description: An unconsumed (PENDING or APPROVED) request already exists
 *       401:
 *         description: Missing/invalid/expired token, or a token not valid for this route
 *       403:
 *         description: Device mismatch, or account inactive
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
    // (mpin_pending) may reach this route — same allowlist as /mpin/verify, for the
    // same reason: the employee may be tapping "Forgot MPIN" before login has
    // finished. mpin_setup is deliberately excluded — there is no MPIN yet to forget.
    if (payload.purpose !== undefined && payload.purpose !== 'mpin_pending') {
      return errorResponse('Invalid or expired token', 401);
    }

    const body = await request.json();
    const validationResult = mpinForgotSchema.safeParse(body);
    if (!validationResult.success) {
      return errorResponse(validationResult.error.errors[0]?.message || 'Invalid input', 400);
    }
    const { deviceId } = validationResult.data;

    const employee = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { id: true, isActive: true, dateOfExit: true, mobileLoginEnabled: true, mobileDeviceId: true },
    });

    if (!employee || getLoginBlockReason(employee, 'MOBILE')) {
      return errorResponse('Employee not found or inactive', 404);
    }

    // Defense-in-depth on top of the token: the physical device making this
    // request must still match the employee's bound device.
    if (employee.mobileDeviceId !== deviceId) {
      return errorResponse('This request must come from the employee\'s registered mobile device.', 403);
    }

    // Blocks on PENDING (spec'd duplicate case) and also APPROVED — an approved
    // request that hasn't been used yet is still a live, unconsumed grant; leaving it
    // possible to request a second one alongside it would let two APPROVED rows exist
    // at once, breaking "one request = one use" for /mpin/change's status check.
    const existingUnconsumed = await prisma.mpinChangeRequest.findFirst({
      where: { employeeId: employee.id, status: { in: ['PENDING', 'APPROVED'] } },
      select: { id: true, status: true },
    });

    if (existingUnconsumed) {
      const isApproved = existingUnconsumed.status === 'APPROVED';
      return jsonResponse(
        {
          success: false,
          code: 'MPIN_CHANGE_REQUEST_PENDING',
          // Lets the mobile app route straight to the "set new MPIN" screen
          // without a second /mpin/change-status round trip.
          canChangeMpin: isApproved,
          message: isApproved
            ? 'An MPIN change request is already approved. Please set your new MPIN before requesting another change.'
            : 'An MPIN change request is already pending approval.',
        },
        409
      );
    }

    await prisma.mpinChangeRequest.create({
      data: { employeeId: employee.id, status: 'PENDING' },
    });

    return successResponse(null, 'MPIN change request submitted successfully. Please wait for administrator approval.');
  } catch (error) {
    console.error('MPIN forgot error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Internal server error', 500);
  }
}
