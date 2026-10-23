import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { hashPassword } from '@/app/lib/auth';
import {
  handleCorsPreflight,
  errorResponse,
  successResponse,
  withAuth,
} from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';

/**
 * Reset password schema
 */
const resetPasswordSchema = z.object({
  newPassword: z.string().min(8, 'Password must be at least 8 characters'),
});

/**
 * @swagger
 * /api/users/{id}/reset-password:
 *   post:
 *     tags:
 *       - Users
 *     summary: Reset User Password
 *     description: Reset a user's password to a new value. **Admin only.**
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID to reset password for
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - newPassword
 *             properties:
 *               newPassword:
 *                 type: string
 *                 minLength: 8
 *                 description: New password (minimum 8 characters)
 *                 example: NewSecurePass123
 *     responses:
 *       200:
 *         description: Password reset successfully
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
 * POST /api/users/[id]/reset-password
 * Reset user password 
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return withAuth(async (req, currentUser) => {
    try {
      const body = await req.json();

      // Validate request body
      const validationResult = resetPasswordSchema.safeParse(body);
      if (!validationResult.success) {
        return errorResponse(
          validationResult.error.errors[0]?.message || 'Invalid request data',
          400
        );
      }

      const { newPassword } = validationResult.data;

      // Check if target user exists
      const user = await prisma.user.findUnique({
        where: { id },
      });

      if (!user) {
        return errorResponse('User not found', 404);
      }

      // Role-based Access Control for Password Reset
      if (currentUser.role === 'FDO' && currentUser.userId !== id) {
          return errorResponse('You can only reset your own password', 403);
      }
      
      if (currentUser.role !== 'ADMIN' && currentUser.userId !== id) {
          // Any non-admin resetting someone else's password (BM, AM, or any other
          // role reaching this route) is scoped to their assigned branches
          // (UserBranchAssignment / AreaManagerBranch), not just their primary branch.
          const permittedBranchIds = await getPermittedBranchIds(currentUser);
          if (permittedBranchIds !== null && (!user.branchId || !permittedBranchIds.includes(user.branchId))) {
             return errorResponse('You can only reset passwords for users in your assigned branches', 403);
          }
      }

      // Hash new password
      const hashedPassword = await hashPassword(newPassword);

      // Update password
      await prisma.user.update({
        where: { id },
        data: { password: hashedPassword },
      });

      return successResponse(null, 'Password reset successfully');
    } catch (error) {
      console.error('Error resetting password:', error);
      return errorResponse('Failed to reset password', 500);
    }
  })(request);
}
