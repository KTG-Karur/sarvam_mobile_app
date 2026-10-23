import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import {
  errorResponse,
  handleCorsPreflight,
  successResponse,
  withAuth,
} from '@/app/lib/api-utils';

export async function OPTIONS() {
  return handleCorsPreflight();
}

/**
 * GET /api/auth/face/re-register/status
 *
 * The mobile app polls this to learn the Admin decision on a face
 * re-registration request. `approved` is true only while an APPROVED request
 * is still un-consumed (a successful /face/register flips it to COMPLETED).
 */
export async function GET(request: NextRequest) {
  return withAuth(async (_req, user) => {
    try {
      const latest = await prisma.faceReRegistrationRequest.findFirst({
        where: { userId: user.userId },
        orderBy: { createdAt: 'desc' },
        select: { status: true, reason: true, rejectionReason: true },
      });

      if (!latest) {
        return successResponse(
          { approved: false, status: 'NONE' },
          'No face re-registration request found'
        );
      }

      return successResponse(
        {
          approved: latest.status === 'APPROVED',
          status: latest.status,
          ...(latest.status === 'REJECTED'
            ? { message: latest.rejectionReason || 'Request rejected by administrator.' }
            : {}),
        },
        'Face re-registration status fetched successfully'
      );
    } catch (error) {
      console.error('[Face ReReg Status] Error:', error);
      return errorResponse(
        error instanceof Error ? error.message : 'Failed to fetch re-registration status',
        500
      );
    }
  })(request);
}
