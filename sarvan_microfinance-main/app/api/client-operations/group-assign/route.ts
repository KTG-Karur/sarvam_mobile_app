import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import {
    validateGroupCapacity,
    GROUP_CAPACITY_FULL_MESSAGE,
    GROUP_NOT_AVAILABLE_MESSAGE,
} from '@/app/lib/services/group-assignment.service';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { getMaxMembersPerGroup } from '@/app/lib/group-assignment-config';

/**
 * Schema for bulk group assignment
 */
const bulkGroupAssignSchema = z.object({
    centerId: z.string().min(1, 'Center ID is required'),
    assignments: z.array(
        z.object({
            clientId: z.string().min(1, 'Client ID is required'),
            groupId: z.string().optional(), // Empty string or null means remove from group
        })
    ).min(1, 'At least one assignment is required'),
});

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * POST /api/client-operations/group-assign
 * Bulk assign clients to groups
 * 
 * Access: BRANCH_MANAGER (own branch only); ADMIN / ADMIN_NON_HO_BRANCH_SWITCH
 * (any permitted branch)
 */
export async function POST(request: NextRequest) {
    return withRole(['BRANCH_MANAGER', 'ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH'], async (req, user) => {
        try {
            const body = await req.json();
            console.log('Received group assignment request:', {
                userId: user.userId,
                assignmentCount: body.assignments?.length
            });

            // Validate request body
            const validationResult = bulkGroupAssignSchema.safeParse(body);
            if (!validationResult.success) {
                return errorResponse(
                    validationResult.error.errors[0]?.message || 'Invalid request data',
                    400
                );
            }

            const { centerId, assignments } = validationResult.data;

            // Verify center exists and is within the caller's scope
            const center = await prisma.center.findUnique({
                where: { id: centerId },
                select: { id: true, branchId: true, name: true },
            });

            if (!center) {
                return errorResponse('Center not found', 404);
            }

            if (user.role === 'BRANCH_MANAGER') {
                // Branch Manager: own branch only (unchanged behaviour)
                const userRecord = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: { branchId: true },
                });
                if (!userRecord || !userRecord.branchId) {
                    return errorResponse('User is not assigned to a branch', 403);
                }
                if (center.branchId !== userRecord.branchId) {
                    return errorResponse('Center does not belong to your branch', 403);
                }
            } else {
                // Admin / Sub-admin: any branch in their permitted scope (null = unrestricted)
                const permitted = await getPermittedBranchIds(user);
                if (permitted !== null && !permitted.includes(center.branchId)) {
                    return errorResponse('Access denied to this branch', 403);
                }
            }

            // Verify all clients belong to the specified center
            const clientIds = assignments.map(a => a.clientId);
            const clients = await prisma.client.findMany({
                where: {
                    id: { in: clientIds },
                    centerId: centerId,
                },
                select: { id: true, clientId: true, firstName: true, lastName: true },
            });

            if (clients.length !== clientIds.length) {
                return errorResponse(
                    'One or more clients do not belong to the specified center',
                    400
                );
            }

            // Get all unique group IDs from assignments (excluding empty strings)
            const groupIds = [...new Set(
                assignments
                    .map(a => a.groupId)
                    .filter(id => id && id.trim() !== '')
            )] as string[];

            // Verify all groups exist and belong to the center
            if (groupIds.length > 0) {
                const groups = await prisma.group.findMany({
                    where: {
                        id: { in: groupIds },
                        centerId: centerId,
                    },
                    select: { id: true, name: true },
                });

                if (groups.length !== groupIds.length) {
                    return errorResponse(
                        'One or more groups do not belong to the specified center',
                        400
                    );
                }
            }

            const maxMembers = await getMaxMembersPerGroup();

            // Perform bulk group assignment using transaction
            const result = await prisma.$transaction(async (tx) => {
                const updates = [];

                for (const assignment of assignments) {
                    const { clientId, groupId } = assignment;
                    const normalizedGroupId = groupId && groupId.trim() !== '' ? groupId : null;

                    // Re-validate capacity per assignment (ACTIVE clients only) —
                    // unassigning (normalizedGroupId === null) never needs a check.
                    if (normalizedGroupId) {
                        await validateGroupCapacity(tx, { groupId: normalizedGroupId, centerId, maxMembers });
                    }

                    // Update client's groupId
                    const updatedClient = await tx.client.update({
                        where: { id: clientId },
                        data: { groupId: normalizedGroupId },
                        select: {
                            id: true,
                            clientId: true,
                            firstName: true,
                            lastName: true,
                            groupId: true,
                        },
                    });

                    // Remove existing group memberships for this client
                    await tx.groupMember.deleteMany({
                        where: { clientId: clientId },
                    });

                    // If assigning to a group, create group membership
                    if (normalizedGroupId) {
                        await tx.groupMember.create({
                            data: {
                                groupId: normalizedGroupId,
                                clientId: clientId,
                            },
                        });
                    }

                    updates.push(updatedClient);
                }

                return updates;
            }, { timeout: 30000, maxWait: 10000 });

            console.log('Group assignment completed:', {
                centerId,
                updatedCount: result.length,
            });

            return successResponse(
                {
                    updatedCount: result.length,
                    clients: result,
                },
                `Successfully updated group assignments for ${result.length} client(s)`,
                200
            );
        } catch (error) {
            console.error('Error assigning groups:', error);

            if (error instanceof Error) {
                const errorMessage = error.message;

                // Handle Prisma errors
                if ('code' in error) {
                    if ((error as any).code === 'P2025') {
                        return errorResponse('One or more clients or groups not found', 404);
                    }
                    if ((error as any).code === 'P2003') {
                        return errorResponse('Invalid client or group ID provided', 400);
                    }
                }

                // validateGroupCapacity throws a plain Error with a known
                // user-facing message (capacity-full or group-unavailable) —
                // surface those verbatim as 409; anything else is a real 500.
                if (errorMessage === GROUP_CAPACITY_FULL_MESSAGE || errorMessage === GROUP_NOT_AVAILABLE_MESSAGE) {
                    return errorResponse(errorMessage, 409);
                }

                return errorResponse(`Failed to assign groups: ${errorMessage}`, 500);
            }

            return errorResponse('Failed to assign groups: Unknown error occurred', 500);
        }
    })(request);
}
