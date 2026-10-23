import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import {
  errorResponse,
  handleCorsPreflight,
  successResponse,
  withAuth,
} from '@/app/lib/api-utils';

const bodySchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export async function OPTIONS() {
  return handleCorsPreflight();
}

/**
 * POST /api/auth/face/re-register/request
 *
 * An already-enrolled user asks Admin for permission to re-register / update
 * their face template. Idempotent while a request is PENDING or APPROVED.
 * First-time enrolment does not need this (no template yet).
 */
export async function POST(request: NextRequest) {
  return withAuth(async (req, user) => {
    try {
      const body = await req.json().catch(() => ({}));
      const parsed = bodySchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse(parsed.error.issues[0]?.message || 'Invalid input', 400);
      }

      const template = await prisma.faceTemplate.findUnique({
        where: { userId: user.userId },
        select: { id: true },
      });
      if (!template) {
        return successResponse(
          { status: 'NOT_REQUIRED' },
          'No face is enrolled yet — you can register directly, no approval needed.'
        );
      }

      const existing = await prisma.faceReRegistrationRequest.findFirst({
        where: { userId: user.userId, status: { in: ['PENDING', 'APPROVED'] } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, status: true },
      });
      if (existing) {
        return successResponse(
          { id: existing.id, status: existing.status },
          existing.status === 'APPROVED'
            ? 'Your re-registration is already approved — you can update your face now.'
            : 'Your re-registration request is already pending Admin approval.'
        );
      }

      const created = await prisma.faceReRegistrationRequest.create({
        data: {
          userId: user.userId,
          reason: parsed.data.reason || null,
          status: 'PENDING',
        },
        select: { id: true, status: true },
      });

      return successResponse(
        { id: created.id, status: created.status },
        'Your face re-registration request was sent. Please wait for Admin approval.',
        201
      );
    } catch (error) {
      console.error('[Face ReReg Request] Error:', error);
      return errorResponse(
        error instanceof Error ? error.message : 'Failed to submit re-registration request',
        500
      );
    }
  })(request);
}
