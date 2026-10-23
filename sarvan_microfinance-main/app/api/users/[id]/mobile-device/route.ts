import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import {
  handleCorsPreflight,
  errorResponse,
  successResponse,
  withRole,
} from '@/app/lib/api-utils';

/**
 * @swagger
 * /api/users/{id}/mobile-device:
 *   get:
 *     tags:
 *       - Users
 *     summary: Get employee's registered mobile device
 *     description: Returns the mobile deviceId bound to this employee, or null if none. **Admin only.**
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Device info fetched
 *       404:
 *         description: User not found
 *       403:
 *         description: Admin access required
 *   delete:
 *     tags:
 *       - Users
 *     summary: Remove employee's registered mobile device
 *     description: Clears the employee's bound mobile deviceId so they can register a new device on their next mobile login. **Admin only.**
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Mobile device removed successfully
 *       404:
 *         description: User not found
 *       403:
 *         description: Admin access required
 */

export async function OPTIONS() {
  return handleCorsPreflight();
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withRole(['ADMIN'], async (req) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id },
        select: {
          id: true,
          employeeId: true,
          firstName: true,
          lastName: true,
          mobileDeviceId: true,
        },
      });

      if (!user) {
        return errorResponse('User not found', 404);
      }

      return successResponse(user, 'Mobile device info fetched successfully');
    } catch (error) {
      console.error('Error fetching mobile device info:', error);
      return errorResponse('Failed to fetch mobile device info', 500);
    }
  })(request);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withRole(['ADMIN'], async (req) => {
    try {
      const user = await prisma.user.findUnique({ where: { id } });

      if (!user) {
        return errorResponse('User not found', 404);
      }

      if (!user.mobileDeviceId) {
        return errorResponse('This employee has no mobile device registered', 400);
      }

      await prisma.user.update({
        where: { id },
        data: { mobileDeviceId: null },
      });

      return successResponse(null, 'Mobile device removed successfully');
    } catch (error) {
      console.error('Error removing mobile device:', error);
      return errorResponse('Failed to remove mobile device', 500);
    }
  })(request);
}
