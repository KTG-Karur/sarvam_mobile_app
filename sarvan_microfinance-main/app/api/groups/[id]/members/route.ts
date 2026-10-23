import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';

/**
 * @swagger
 * /api/groups/{id}/members:
 *   get:
 *     tags:
 *       - Groups
 *     summary: Get Group Members
 *     description: Fetch all members of a specific group
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Group ID
 *     responses:
 *       200:
 *         description: Members fetched successfully
 *       404:
 *         description: Group not found
 */

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/groups/[id]/members
 * Fetch members of a specific group
 */
export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    return withAuth(async (req, user) => {
        try {
            const { id } = await context.params;

            // Verify group exists
            const group = await prisma.group.findUnique({
                where: { id },
                select: {
                    id: true,
                    centerId: true,
                    center: {
                        select: {
                            branchId: true,
                        },
                    },
                },
            });

            if (!group) {
                return errorResponse('Group not found', 404);
            }

            // Branch Managers can only access groups from their branch
            if (user.role === 'BRANCH_MANAGER') {
                const userRecord = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: { branchId: true },
                });

                if (!userRecord || !userRecord.branchId) {
                    return errorResponse('User is not assigned to a branch', 403);
                }

                if (group.center.branchId !== userRecord.branchId) {
                    return errorResponse('Access denied to this group', 403);
                }
            }

            // Fetch group members — active clients only, to match the
            // active-only memberCount shown everywhere else (GET /api/groups).
            const members = await prisma.groupMember.findMany({
                where: {
                    groupId: id,
                    client: { isActive: true },
                },
                select: {
                    id: true,
                    joinedAt: true,
                    client: {
                        select: {
                            id: true,
                            clientId: true,
                            firstName: true,
                            lastName: true,
                            phone: true,
                            mobileNumber: true,
                        },
                    },
                },
                orderBy: {
                    joinedAt: 'asc',
                },
            });

            // Format response
            const formattedMembers = members.map((member) => ({
                id: member.id,
                clientId: member.client.clientId,
                clientDbId: member.client.id,
                clientName: `${member.client.firstName} ${member.client.lastName}`,
                phone: member.client.phone || member.client.mobileNumber || null,
                joinedDate: member.joinedAt.toISOString(),
            }));

            return successResponse(formattedMembers, 'Members fetched successfully');
        } catch (error) {
            console.error('Error fetching group members:', error);
            return errorResponse('Failed to fetch group members', 500);
        }
    })(request);
}
