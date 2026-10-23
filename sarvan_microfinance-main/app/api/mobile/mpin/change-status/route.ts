import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { verifyAccessToken } from '@/app/lib/auth';
import { handleCorsPreflight, errorResponse, successResponse } from '@/app/lib/api-utils';

/**
 * @swagger
 * /api/mobile/mpin/change-status:
 *   get:
 *     tags:
 *       - Authentication
 *     summary: Check the employee's current MPIN change request status
 *     description: >
 *       Returns the status of the employee's most recent MpinChangeRequest, if any.
 *       canChangeMpin is true only when that request is APPROVED — the mobile app
 *       should show the "Create new MPIN" screen only in that case.
 *     responses:
 *       200:
 *         description: Current status (or none) for this employee
 */

export async function OPTIONS() {
  return handleCorsPreflight();
}

async function handleChangeStatus(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return errorResponse('Authentication required', 401);
    }

    let user;
    try {
      user = verifyAccessToken(authHeader.substring(7));
    } catch {
      return errorResponse('Invalid or expired token', 401);
    }

    // This status check is called from the MPIN login screen before the
    // employee has completed login. `mpin_pending` is the only purpose token
    // that may access it; the shared withAuth middleware correctly rejects all
    // purpose tokens, which previously made this request return 401 and caused
    // APPROVED requests to be handled by the duplicate-request fallback.
    if (user.purpose !== undefined && user.purpose !== 'mpin_pending') {
      return errorResponse('Invalid or expired token', 401);
    }

    // A terminal request is only history. Prefer the one live request so an
    // older COMPLETED entry can never mask a currently APPROVED request.
    const activeRequest = await prisma.mpinChangeRequest.findFirst({
      where: {
        employeeId: user.userId,
        status: { in: ['PENDING', 'APPROVED'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { status: true, rejectionReason: true },
    });
    const latest = activeRequest ?? await prisma.mpinChangeRequest.findFirst({
      where: { employeeId: user.userId },
      orderBy: { createdAt: 'desc' },
      select: { status: true, rejectionReason: true },
    });

    if (!latest) {
      return successResponse({ status: null, canChangeMpin: false }, 'No MPIN change request found');
    }

    return successResponse(
      {
        status: latest.status,
        canChangeMpin: latest.status === 'APPROVED',
        ...(latest.status === 'REJECTED'
          ? { reason: latest.rejectionReason || 'Request rejected by administrator.' }
          : {}),
      },
      'MPIN change request status fetched successfully'
    );
  } catch (error) {
    console.error('MPIN change-status error:', error);
    return errorResponse(error instanceof Error ? error.message : 'Internal server error', 500);
  }
}

export async function GET(request: NextRequest) {
  return handleChangeStatus(request);
}

// The mobile app polls this endpoint with POST — keep both methods working.
export async function POST(request: NextRequest) {
  return handleChangeStatus(request);
}
