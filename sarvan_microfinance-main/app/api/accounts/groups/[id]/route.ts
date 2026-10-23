import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { z } from 'zod';

const updateGroupSchema = z.object({
    groupName: z.string().min(1, "Group Name is required").optional(),
    parentGroupId: z.string().nullable().optional(),
    allowSubGroups: z.boolean().optional(),
});

/**
 * PUT /api/accounts/groups/[id]
 * Update an account group
 */
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    return withAuth(async (req) => {
        try {
            const body = await req.json();
            const validation = updateGroupSchema.safeParse(body);

            if (!validation.success) {
                return errorResponse(validation.error.errors[0].message, 400);
            }
            const data = validation.data;

            return await prisma.$transaction(async (tx) => {
                // 1. Check existence
                const existingGroup = await tx.accountGroup.findUnique({
                    where: { id }
                });

                if (!existingGroup) {
                    throw new Error('Group not found');
                }

                // 2. Validate Parent if changing
                if (data.parentGroupId !== undefined && data.parentGroupId !== null) {
                    // Prevent circular reference: cannot be its own parent
                    if (data.parentGroupId === existingGroup.groupId) {
                        throw new Error('A group cannot be its own parent');
                    }

                    const parent = await tx.accountGroup.findUnique({
                        where: { groupId: data.parentGroupId }
                    });

                    if (!parent) {
                        throw new Error('Selected Parent Group does not exist');
                    }
                    if (!parent.allowSubGroups) {
                        throw new Error(`Parent group "${parent.groupName}" does not allow sub-groups`);
                    }
                }

                // 3. Check for duplicate name within the (possibly new) parent group
                const effectiveParentId = data.parentGroupId !== undefined ? data.parentGroupId : existingGroup.parentGroupId;
                const effectiveName = data.groupName ?? existingGroup.groupName;

                const duplicate = await tx.accountGroup.findFirst({
                    where: {
                        id: { not: id },
                        groupName: { equals: effectiveName, mode: 'insensitive' },
                        parentGroupId: effectiveParentId,
                        isActive: true,
                    }
                });

                if (duplicate) {
                    throw new Error(`Group Name "${effectiveName}" already exists under this parent group`);
                }

                // 4. Update
                const updatedGroup = await tx.accountGroup.update({
                    where: { id },
                    data: {
                        groupName: data.groupName,
                        parentGroupId: data.parentGroupId,
                        allowSubGroups: data.allowSubGroups,
                        isPrimary: data.parentGroupId === null ? true : (data.parentGroupId === undefined ? undefined : false)
                    }
                });

                return successResponse(updatedGroup, 'Group updated successfully');
            });

        } catch (error: any) {
            console.error('Error updating group:', error);
            if (error.message === 'Group not found') {
                return errorResponse(error.message, 404);
            }
            if (error.message.includes('already exists')) {
                return errorResponse(error.message, 409);
            }
            if (
                error.message.includes('sub-groups') ||
                error.message.includes('own parent') ||
                error.message.includes('does not exist')
            ) {
                return errorResponse(error.message, 400);
            }
            return errorResponse('Failed to update group', 500);
        }
    })(request);
}

/**
 * DELETE /api/accounts/groups/[id]
 * Delete an account group
 */
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    return withAuth(async (req) => {
        try {
            const group = await prisma.accountGroup.findUnique({
                where: { id },
                include: {
                    _count: {
                        select: { subGroups: true, ledgers: true }
                    }
                }
            });

            if (!group) {
                return errorResponse('Group not found', 404);
            }

            if (group.isSystemGroup) {
                return errorResponse('Cannot delete a system restricted group', 403);
            }

            if (group._count.subGroups > 0) {
                return errorResponse('Cannot delete group that has sub-groups. Delete the sub-groups first.', 400);
            }

            if (group._count.ledgers > 0) {
                return errorResponse('Cannot delete group that has ledgers or transactions linked. Delete the ledgers/transactions first.', 400);
            }

            await prisma.accountGroup.delete({
                where: { id }
            });

            return successResponse(null, 'Group deleted successfully');
        } catch (error) {
            console.error('Error deleting group:', error);
            return errorResponse('Failed to delete group', 500);
        }
    })(request);
}
