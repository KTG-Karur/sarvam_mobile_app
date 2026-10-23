import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { Prisma } from '@prisma/client';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
    withRole,
} from '@/app/lib/api-utils';
import { createNextGroupForCenter } from '@/app/lib/services/group-assignment.service';
import { getMaxMembersPerGroup } from '@/app/lib/group-assignment-config';

/**
 * Create group schema — the Group Name/Number are auto-generated
 * ("<Center Name> - N"); only the target center is supplied by the caller.
 */
const createGroupSchema = z.object({
    centerId: z.string().min(1, 'Center ID is required'),
});

/**
 * @swagger
 * /api/groups:
 *   get:
 *     tags:
 *       - Groups
 *     summary: List Groups
 *     description: |
 *       Fetch groups with role-based filtering:
 *       - **BRANCH_MANAGER**: Only sees groups from centers in their branch
 *     parameters:
 *       - in: query
 *         name: branchId
 *         schema:
 *           type: string
 *         description: Filter by branch ID
 *       - in: query
 *         name: centerId
 *         schema:
 *           type: string
 *         description: Filter by center ID
 *       - in: query
 *         name: includeInactive
 *         schema:
 *           type: boolean
 *         description: Include inactive groups
 *       - in: query
 *         name: availableOnly
 *         schema:
 *           type: boolean
 *         description: Only return groups with spare active-member capacity (used by assignment dropdowns)
 *     responses:
 *       200:
 *         description: Groups fetched successfully
 *   post:
 *     tags:
 *       - Groups
 *     summary: Create Group
 *     description: |
 *       Create the next auto-numbered/auto-named group for a center
 *       ("<Center Name> - N"). **Branch Manager only.**
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - centerId
 *             properties:
 *               centerId:
 *                 type: string
 *     responses:
 *       201:
 *         description: Group created successfully
 *       400:
 *         description: Invalid data
 *       403:
 *         description: Branch Manager access required
 */

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/groups
 * Fetch groups with dynamic member counts
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const branchId = searchParams.get('branchId');
            const centerId = searchParams.get('centerId');
            const includeInactive = searchParams.get('includeInactive') === 'true';
            const availableOnly = searchParams.get('availableOnly') === 'true';

            // Build where clause
            const where: Prisma.GroupWhereInput = {};

            // Branch Managers can only see groups from centers in their branch
            if (user.role === 'BRANCH_MANAGER') {
                const userRecord = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: { branchId: true },
                });

                if (!userRecord || !userRecord.branchId) {
                    return successResponse([], 'No groups found');
                }

                // Filter by centers in user's branch
                where.center = {
                    branchId: userRecord.branchId,
                };
            } else if (branchId) {
                // Admins can filter by branchId
                where.center = {
                    branchId: branchId,
                };
            }

            // Filter by center if provided
            if (centerId) {
                where.centerId = centerId;
            }

            // Filter by active status
            if (!includeInactive) {
                where.isActive = true;
            }

            // Fetch groups with member counts
            const groups = await prisma.group.findMany({
                where,
                select: {
                    id: true,
                    name: true,
                    code: true,
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
                            branchId: true,
                            centerLeaderId: true,
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
                            // Capacity is ACTIVE clients only — a client marked
                            // inactive keeps its GroupMember row but must not
                            // occupy a capacity slot.
                            members: { where: { client: { isActive: true } } },
                        },
                    },
                },
                orderBy: {
                    createdAt: 'desc',
                },
            });

            const maxMembersPerGroup = await getMaxMembersPerGroup();

            // Map to include member count and format data
            let groupsWithCounts = groups.map((group) => ({
                id: group.id,
                name: group.name,
                code: group.code,
                centerId: group.centerId,
                centerName: group.center.name,
                centerCode: group.center.code,
                centerLeaderId: group.center.centerLeaderId,
                memberCount: group._count.members,
                maxMembersPerGroup,
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
            }));

            // Assignment dropdowns only want groups with spare capacity —
            // full groups must never be selectable for a new assignment.
            if (availableOnly) {
                groupsWithCounts = groupsWithCounts.filter((g) => g.memberCount < maxMembersPerGroup);
            }

            return successResponse(groupsWithCounts, 'Groups fetched successfully');
        } catch (error) {
            console.error('Error fetching groups:', error);
            return successResponse([], 'No groups found');
        }
    })(request);
}

/**
 * POST /api/groups
 * Create the next auto-numbered/auto-named group for a center (Branch Manager only).
 * This is the ONLY place in the app that creates a Group — see
 * app/lib/services/group-assignment.service.ts for the rationale.
 */
export async function POST(request: NextRequest) {
    return withRole(['BRANCH_MANAGER'], async (req, user) => {
        try {
            const body = await req.json();

            // Validate request body
            const validationResult = createGroupSchema.safeParse(body);
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

            // Verify center exists and belongs to user's branch
            const center = await prisma.center.findUnique({
                where: { id: data.centerId },
                select: { id: true, branchId: true, name: true },
            });

            if (!center) {
                return errorResponse('Center not found', 404);
            }

            if (center.branchId !== userRecord.branchId) {
                return errorResponse('Center does not belong to your branch', 403);
            }

            const created = await prisma.$transaction(
                (tx) => createNextGroupForCenter(tx, { centerId: data.centerId, createdById: user.userId }),
                { timeout: 15000, maxWait: 5000 }
            );

            // Re-fetch with display fields (center/createdBy) for the response shape.
            const group = await prisma.group.findUniqueOrThrow({
                where: { id: created.id },
                select: {
                    id: true,
                    name: true,
                    code: true,
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
                            centerLeaderId: true,
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
                            members: { where: { client: { isActive: true } } },
                        },
                    },
                },
            });

            // Format response
            const formattedGroup = {
                id: group.id,
                name: group.name,
                code: group.code,
                centerId: group.centerId,
                centerName: group.center.name,
                centerCode: group.center.code,
                centerLeaderId: group.center.centerLeaderId,
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

            return successResponse(formattedGroup, 'Group created successfully', 201);
        } catch (error) {
            console.error('Error creating group:', error);

            if (error instanceof Error) {
                const errorMessage = error.message;

                // Handle Prisma errors
                if ('code' in error) {
                    if ((error as any).code === 'P2002') {
                        return errorResponse('Group with this name already exists in this center', 409);
                    }
                    if ((error as any).code === 'P2003') {
                        return errorResponse('Invalid Center ID provided', 400);
                    }
                }

                return errorResponse(`Failed to create group: ${errorMessage}`, 500);
            }

            return errorResponse('Failed to create group: Unknown error occurred', 500);
        }
    })(request);
}
