import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { z } from 'zod';

const createGroupSchema = z.object({
    // groupId is now auto-generated
    groupName: z.string().min(1, "Group Name is required"),
    parentGroupId: z.string().nullable().optional(),
    allowSubGroups: z.boolean().default(false),
});

/**
 * GET /api/accounts/groups
 * Fetch all account groups
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req) => {
        try {
            const groups = await prisma.accountGroup.findMany({
                orderBy: {
                    // We want numeric sorting if possible, but prisma orderBy string is alphabetic (1, 10, 2).
                    // We'll sort in JS or accept strict alpha sort for now.
                    // But usually created order matches numeric order if auto-incremented.
                    createdAt: 'asc'
                },
                include: {
                    parentGroup: {
                        select: {
                            groupName: true,
                            groupId: true
                        }
                    },
                    _count: {
                        select: {
                            subGroups: true,
                            ledgers: true
                        }
                    }
                },
                where: {
                    isActive: true
                }
            });

            // Transform for UI
            const formattedGroups = groups.map(g => ({
                ...g,
                subGroupsCount: g._count.subGroups,
                ledgersCount: g._count.ledgers
            }));

            // Sort numerically in JS to be safe
            formattedGroups.sort((a, b) => {
                const numA = parseInt(a.groupId, 10);
                const numB = parseInt(b.groupId, 10);
                if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
                return a.groupId.localeCompare(b.groupId);
            });

            return successResponse(formattedGroups, 'Groups fetched successfully');
        } catch (error) {
            console.error('Error fetching groups:', error);
            return errorResponse('Failed to fetch groups', 500);
        }
    })(request);
}

/**
 * POST /api/accounts/groups
 * Create a new account group
 */
export async function POST(request: NextRequest) {
    return withAuth(async (req) => {
        try {
            const body = await req.json();

            const validation = createGroupSchema.safeParse(body);
            if (!validation.success) {
                return errorResponse(validation.error.errors[0].message, 400);
            }

            const data = validation.data;

            // 1. Check for duplicate name within the same parent group, and
            // validate parent existence, once up front (outside the retry loop).
            const existingName = await prisma.accountGroup.findFirst({
                where: {
                    groupName: { equals: data.groupName, mode: 'insensitive' },
                    parentGroupId: data.parentGroupId || null,
                    isActive: true
                }
            });

            if (existingName) {
                return errorResponse(`Group Name "${data.groupName}" already exists under this parent group`, 409);
            }

            if (data.parentGroupId) {
                const parent = await prisma.accountGroup.findUnique({
                    where: { groupId: data.parentGroupId }
                });

                if (!parent) {
                    return errorResponse('Selected Parent Group does not exist', 409);
                }
                if (!parent.allowSubGroups) {
                    return errorResponse(`Parent group "${parent.groupName}" does not allow sub-groups`, 409);
                }
            }

            // 2. Auto-generate Numeric Group ID and create, retrying on a
            // concurrent-insert collision (two requests racing on the same
            // max(groupId) + 1) instead of failing the whole request.
            const MAX_ATTEMPTS = 5;
            for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                try {
                    const allGroups = await prisma.accountGroup.findMany({
                        select: { groupId: true }
                    });

                    let maxId = 0;
                    for (const g of allGroups) {
                        const num = parseInt(g.groupId, 10);
                        if (!isNaN(num) && num > maxId) {
                            maxId = num;
                        }
                    }
                    const nextGroupId = (maxId + 1).toString();

                    const newGroup = await prisma.accountGroup.create({
                        data: {
                            groupId: nextGroupId,
                            groupName: data.groupName,
                            parentGroupId: data.parentGroupId || null,
                            allowSubGroups: data.allowSubGroups,
                            isPrimary: !data.parentGroupId,
                            isActive: true
                        }
                    });

                    return successResponse(newGroup, 'Account Group created successfully', 201);
                } catch (error: any) {
                    const isGroupIdCollision = error.code === 'P2002' && error.meta?.target?.includes?.('groupId');
                    if (isGroupIdCollision && attempt < MAX_ATTEMPTS) {
                        continue; // another request just took this groupId — recompute and retry
                    }
                    throw error;
                }
            }

            return errorResponse('Failed to allocate a Group ID after multiple attempts', 500);

        } catch (error: any) {
            console.error('Error creating group:', error);
            return errorResponse(error.message || 'Failed to create account group', 500);
        }
    })(request);
}
