import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';

/**
 * Update group schema
 */
const updateGroupSchema = z.object({
    name: z.string().min(1, 'Group name is required').max(200, 'Group name is too long'),
});

/**
 * @swagger
 * /api/groups/{id}:
 *   put:
 *     tags:
 *       - Groups
 *     summary: Update Group
 *     description: Update group name. **Branch Manager only.**
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Group ID
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 example: Updated Group Name
 *     responses:
 *       200:
 *         description: Group updated successfully
 *       403:
 *         description: Access denied
 *       404:
 *         description: Group not found
 */

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * PUT /api/groups/[id]
 * Update a group name (Branch Manager only)
 */
export async function PUT(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    return withRole(['BRANCH_MANAGER'], async (req, user) => {
        try {
            const { id } = await context.params;
            const body = await req.json();

            // Validate request body
            const validationResult = updateGroupSchema.safeParse(body);
            if (!validationResult.success) {
                return errorResponse(
                    validationResult.error.errors[0]?.message || 'Invalid request data',
                    400
                );
            }

            const data = validationResult.data;

            // Verify user is assigned to a branch
            const userRecord = await prisma.user.findUnique({
                where: { id: user.userId },
                select: { branchId: true },
            });

            if (!userRecord || !userRecord.branchId) {
                return errorResponse('User is not assigned to a branch', 403);
            }

            // Verify group exists and belongs to user's branch
            const existingGroup = await prisma.group.findUnique({
                where: { id },
                select: {
                    id: true,
                    center: {
                        select: {
                            branchId: true,
                        },
                    },
                },
            });

            if (!existingGroup) {
                return errorResponse('Group not found', 404);
            }

            if (existingGroup.center.branchId !== userRecord.branchId) {
                return errorResponse('Access denied to this group', 403);
            }

            // Update group
            const group = await prisma.group.update({
                where: { id },
                data: {
                    name: data.name.trim(),
                },
                select: {
                    id: true,
                    name: true,
                    centerId: true,
                    status: true,
                    isActive: true,
                    createdAt: true,
                    updatedAt: true,
                    center: {
                        select: {
                            id: true,
                            name: true,
                            code: true,
                        },
                    },
                    createdBy: {
                        select: {
                            id: true,
                            firstName: true,
                            lastName: true,
                        },
                    },
                    _count: {
                        select: {
                            members: true,
                        },
                    },
                },
            });

            // Format response
            const formattedGroup = {
                id: group.id,
                name: group.name,
                centerId: group.centerId,
                centerName: group.center.name,
                centerCode: group.center.code,
                memberCount: group._count.members,
                status: group.status,
                isActive: group.isActive,
                createdAt: group.createdAt.toISOString(),
                updatedAt: group.updatedAt.toISOString(),
                createdBy: group.createdBy
                    ? {
                        id: group.createdBy.id,
                        firstName: group.createdBy.firstName,
                        lastName: group.createdBy.lastName,
                    }
                    : undefined,
            };

            return successResponse(formattedGroup, 'Group updated successfully');
        } catch (error) {
            console.error('Error updating group:', error);

            if (error instanceof Error) {
                const errorMessage = error.message;

                // Handle Prisma errors
                if ('code' in error) {
                    if ((error as any).code === 'P2025') {
                        return errorResponse('Group not found', 404);
                    }
                }

                return errorResponse(`Failed to update group: ${errorMessage}`, 500);
            }

            return errorResponse('Failed to update group: Unknown error occurred', 500);
        }
    })(request);
}
