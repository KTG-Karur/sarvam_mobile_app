import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import {
  handleCorsPreflight,
  errorResponse,
  successResponse,
  withRole,
} from '@/app/lib/api-utils';
import { bumpMasterDataVersion } from '@/app/lib/cache/master-data-cache';

/**
 * Suspend/Activate user schema
 */
const suspendUserSchema = z.object({
  isActive: z.boolean(),
});

/**
 * @swagger
 * /api/users/{id}/suspend:
 *   post:
 *     tags:
 *       - Users
 *     summary: Suspend or Activate User
 *     description: Toggle user active status. Set isActive to false to suspend, true to activate. **Admin only.**
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID to suspend/activate
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - isActive
 *             properties:
 *               isActive:
 *                 type: boolean
 *                 description: true to activate, false to suspend
 *                 example: false
 *     responses:
 *       200:
 *         description: User status updated successfully
 *       404:
 *         description: User not found
 *       403:
 *         description: Admin access required
 */

/**
 * OPTIONS handler for CORS preflight
 */
export async function OPTIONS() {
  return handleCorsPreflight();
}

/**
 * POST /api/users/[id]/suspend
 * Suspend or activate user (Admin only)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withRole(['ADMIN'], async (req) => {
    try {
      const body = await req.json();

      // Validate request body
      const validationResult = suspendUserSchema.safeParse(body);
      if (!validationResult.success) {
        return errorResponse(
          validationResult.error.errors[0]?.message || 'Invalid request data',
          400
        );
      }

      const { isActive } = validationResult.data;

      // Check if user exists
      const user = await prisma.user.findUnique({
        where: { id },
      });

      if (!user) {
        return errorResponse('User not found', 404);
      }

      // Update user status
      const updatedUser = await prisma.user.update({
        where: { id },
        data: { isActive },
        select: {
          id: true,
          mobileNumber: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          branchId: true,
          isActive: true,
          branch: {
            select: {
              id: true,
              name: true,
              code: true,
            },
          },
        },
      });

      await bumpMasterDataVersion('employees');
      return successResponse(
        updatedUser,
        isActive ? 'User activated successfully' : 'User suspended successfully'
      );
    } catch (error) {
      console.error('Error updating user status:', error);
      return errorResponse('Failed to update user status', 500);
    }
  })(request);
}
