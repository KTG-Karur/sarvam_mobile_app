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
 * Assign branch schema
 */
const assignBranchSchema = z.object({
  branchId: z.string().nullable(),
});

/**
 * @swagger
 * /api/users/{id}/assign-branch:
 *   post:
 *     tags:
 *       - Users
 *     summary: Assign User to Branch
 *     description: Assign or remove a user's branch assignment. Set branchId to null to remove assignment. **Admin only.**
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: User ID to assign branch to
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - branchId
 *             properties:
 *               branchId:
 *                 type: string
 *                 nullable: true
 *                 description: Branch ID to assign, or null to remove assignment
 *     responses:
 *       200:
 *         description: Branch assigned successfully
 *       400:
 *         description: Invalid branch ID or branch not active
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
 * POST /api/users/[id]/assign-branch
 * Assign user to branch (Admin only)
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
      const validationResult = assignBranchSchema.safeParse(body);
      if (!validationResult.success) {
        return errorResponse(
          validationResult.error.errors[0]?.message || 'Invalid request data',
          400
        );
      }

      const { branchId } = validationResult.data;

      // Check if user exists
      const user = await prisma.user.findUnique({
        where: { id },
      });

      if (!user) {
        return errorResponse('User not found', 404);
      }

      // Validate branch if provided
      if (branchId) {
        const branch = await prisma.branch.findUnique({
          where: { id: branchId },
        });

        if (!branch) {
          return errorResponse('Invalid branch ID', 400);
        }

        if (!branch.isActive) {
          return errorResponse('Branch is not active', 400);
        }
      }

      // Update user branch
      const updatedUser = await prisma.user.update({
        where: { id },
        data: { branchId: branchId || null },
        select: {
          id: true,
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
      return successResponse(updatedUser, 'Branch assigned successfully');
    } catch (error) {
      console.error('Error assigning branch:', error);
      return errorResponse('Failed to assign branch', 500);
    }
  })(request);
}
