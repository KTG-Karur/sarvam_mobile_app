import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import * as z from 'zod';

const actionSchema = z.object({
  action: z.enum(['APPROVE', 'REJECT']),
  rejectionReason: z.string().optional(),
});

export async function OPTIONS() {
  return handleCorsPreflight();
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withRole(['ADMIN'], async (req, adminUser) => {
    try {
      const body = await req.json();
      const validationResult = actionSchema.safeParse(body);

      if (!validationResult.success) {
        const firstError = validationResult.error.errors[0];
        return errorResponse(firstError?.message || 'Invalid action payload', 400);
      }

      const { action, rejectionReason } = validationResult.data;

      const deviceReq = await prisma.deviceAccessRequest.findUnique({
        where: { id },
        include: { user: true },
      });

      if (!deviceReq) {
        return errorResponse('Device access request not found', 404);
      }

      if (deviceReq.status !== 'PENDING') {
        return errorResponse(`This request has already been ${deviceReq.status.toLowerCase()}`, 400);
      }

      if (action === 'REJECT') {
        const updated = await prisma.deviceAccessRequest.update({
          where: { id },
          data: {
            status: 'REJECTED',
            rejectionReason: rejectionReason || 'Rejected by Admin',
            reviewedById: adminUser.userId,
            reviewedAt: new Date(),
          },
        });
        return successResponse(updated, 'Device access request rejected');
      }

      // Action === 'APPROVE'
      const newDeviceId = deviceReq.deviceId;
      const userId = deviceReq.userId;

      // 1. Unbind this deviceId if associated with another user
      await prisma.user.updateMany({
        where: { mobileDeviceId: newDeviceId, id: { not: userId } },
        data: { mobileDeviceId: null },
      });

      // 2. Bind user to new mobile deviceId
      await prisma.user.update({
        where: { id: userId },
        data: { mobileDeviceId: newDeviceId },
      });

      // 3. Invalidate/revoke previous session refresh tokens
      await prisma.refreshToken.deleteMany({ where: { userId } });

      // 4. Mark previous active login history entries as logged out
      await prisma.deviceLoginHistory.updateMany({
        where: { userId, logoutAt: null },
        data: { logoutAt: new Date() },
      });

      // 5. Create new login history record
      await prisma.deviceLoginHistory.create({
        data: {
          userId,
          employeeId: deviceReq.employeeId,
          deviceId: newDeviceId,
          deviceName: deviceReq.deviceName,
          adminApprovalStatus: 'APPROVED_BY_ADMIN',
        },
      });

      // 6. Update request status to APPROVED
      const updatedReq = await prisma.deviceAccessRequest.update({
        where: { id },
        data: {
          status: 'APPROVED',
          reviewedById: adminUser.userId,
          reviewedAt: new Date(),
        },
      });

      return successResponse(
        updatedReq,
        'Device access request approved successfully. The user can now log in from the new device.'
      );
    } catch (error) {
      console.error('Error processing device access request:', error);
      return errorResponse(
        error instanceof Error ? error.message : 'Failed to process device access request',
        500
      );
    }
  })(request);
}
