import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { cachedMasterData, stableParamsKey, bumpMasterDataVersion } from '@/app/lib/cache/master-data-cache';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// GET /api/economic-activities
export async function GET(request: NextRequest) {
    return withRole(['ADMIN', 'BRANCH_MANAGER', 'FDO', 'AREA_MANAGER'], async () => {
        try {
            const { searchParams } = new URL(request.url);
            const id = searchParams.get('id');
            const includeInactive = searchParams.get('includeInactive') === 'true';
            const includeType = searchParams.get('includeType') === 'true';
            const activityTypeId = searchParams.get('activityTypeId');
            const search = searchParams.get('search');

            // ── Single record fetch ──
            if (id) {
                const activity = await prisma.economicActivity.findUnique({
                    where: { id },
                    include: includeType ? {
                        economicActivityType: true
                    } : undefined,
                });

                if (!activity) {
                    return errorResponse('Economic activity not found', 404);
                }

                return successResponse(activity, 'Activity fetched successfully');
            }

            // ── Build where clause for filtering ──
            const whereClause: any = includeInactive ? {} : { isActive: true };

            // Add type filter if provided
            if (activityTypeId) {
                whereClause.economicActivityTypeId = activityTypeId;
            }

            // Add search filter if provided
            if (search) {
                whereClause.name = {
                    contains: search,
                    mode: 'insensitive',
                };
            }

            // ── Fetch all activities with optional includes ──
            const fetchActivities = () => prisma.economicActivity.findMany({
                where: whereClause,
                include: includeType ? {
                    economicActivityType: true
                } : undefined,
                orderBy: { createdAt: 'desc' },
            });
            const activities = search
                ? await fetchActivities()
                : await cachedMasterData(
                    'economicActivities',
                    stableParamsKey({ includeInactive, activityTypeId: activityTypeId ?? null, includeType }),
                    fetchActivities
                );

            // ── Add client count to each activity ──
            const activitiesWithCount = await Promise.all(
                activities.map(async (activity) => {
                    const count = await prisma.client.count({
                        where: {
                            economicActivityId: activity.id,
                            isActive: true,
                        },
                    });
                    return {
                        ...activity,
                        _count: { clients: count },
                    };
                })
            );

            return successResponse(activitiesWithCount, 'Activities fetched successfully');
        } catch (error) {
            console.error('Error fetching economic activities:', error);
            return errorResponse('Failed to fetch economic activities', 500);
        }
    })(request);
}

// POST /api/economic-activities
export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async () => {
        try {
            const body = await request.json();

            if (!body.name?.trim()) {
                return errorResponse('Activity name is required', 400);
            }

            if (!body.economicActivityTypeId) {
                return errorResponse('Activity type is required', 400);
            }

            const normalizedName = body.name.trim();

            // Verify that the activity type exists
            const activityType = await prisma.economicActivityType.findUnique({
                where: { id: body.economicActivityTypeId },
            });

            if (!activityType) {
                return errorResponse('Economic activity type not found', 404);
            }

            // Check for duplicate within the same type
            const existingActivity = await prisma.economicActivity.findFirst({
                where: {
                    name: {
                        equals: normalizedName,
                        mode: 'insensitive',
                    },
                    economicActivityTypeId: body.economicActivityTypeId,
                    isActive: true,
                },
            });

            if (existingActivity) {
                return errorResponse('Activity name already exists for this activity type', 409);
            }

            // Generate activity ID
            const existingActivities = await prisma.economicActivity.findMany({
                select: { activityId: true },
                orderBy: { createdAt: 'desc' },
            });

            let nextNumber = 1;
            if (existingActivities.length > 0) {
                const numbers = existingActivities
                    .map((a) => {
                        const match = a.activityId.match(/ACTIVITY-(\d+)/);
                        return match ? parseInt(match[1], 10) : 0;
                    })
                    .filter((n) => n > 0);
                if (numbers.length > 0) {
                    nextNumber = Math.max(...numbers) + 1;
                }
            }
            const activityId = `ACTIVITY-${String(nextNumber).padStart(4, '0')}`;

            const activity = await prisma.economicActivity.create({
                data: {
                    activityId,
                    name: normalizedName,
                    economicActivityTypeId: body.economicActivityTypeId,
                    isActive: true,
                },
                include: {
                    economicActivityType: true
                }
            });

            await bumpMasterDataVersion('economicActivities');
            await bumpMasterDataVersion('economicActivityTypes'); // embeds activities when includeActivities/includeCount is requested
            return successResponse(activity, 'Economic activity created successfully', 201);
        } catch (error) {
            console.error('Error creating economic activity:', error);
            return errorResponse('Failed to create economic activity', 500);
        }
    })(request);
}

// PUT /api/economic-activities
export async function PUT(request: NextRequest) {
    return withRole(['ADMIN'], async () => {
        try {
            const body = await request.json();

            if (!body.id) {
                return errorResponse('Activity ID is required', 400);
            }

            if (!body.name?.trim()) {
                return errorResponse('Activity name is required', 400);
            }

            const existingActivity = await prisma.economicActivity.findUnique({
                where: { id: body.id },
            });

            if (!existingActivity) {
                return errorResponse('Economic activity not found', 404);
            }

            const normalizedName = body.name.trim();

            // Check for duplicate within the same type
            const duplicateActivity = await prisma.economicActivity.findFirst({
                where: {
                    name: {
                        equals: normalizedName,
                        mode: 'insensitive',
                    },
                    economicActivityTypeId: body.economicActivityTypeId || existingActivity.economicActivityTypeId,
                    id: { not: body.id },
                    isActive: true,
                },
            });

            if (duplicateActivity) {
                return errorResponse('Activity name already exists for this activity type', 409);
            }

            const updatedActivity = await prisma.economicActivity.update({
                where: { id: body.id },
                data: {
                    name: normalizedName,
                    economicActivityTypeId: body.economicActivityTypeId || undefined,
                },
                include: {
                    economicActivityType: true
                }
            });

            await bumpMasterDataVersion('economicActivities');
            await bumpMasterDataVersion('economicActivityTypes');
            return successResponse(updatedActivity, 'Economic activity updated successfully');
        } catch (error) {
            console.error('Error updating economic activity:', error);
            return errorResponse('Failed to update economic activity', 500);
        }
    })(request);
}

// DELETE /api/economic-activities
export async function DELETE(request: NextRequest) {
    return withRole(['ADMIN'], async () => {
        try {
            const { searchParams } = new URL(request.url);
            const id = searchParams.get('id');

            if (!id) {
                return errorResponse('Activity ID is required', 400);
            }

            const existingActivity = await prisma.economicActivity.findUnique({
                where: { id },
            });

            if (!existingActivity) {
                return errorResponse('Economic activity not found', 404);
            }

            // Check if any clients are linked to this activity
            const clientCount = await prisma.client.count({
                where: {
                    economicActivityId: id,
                    isActive: true,
                },
            });

            if (clientCount > 0) {
                return errorResponse(
                    `Cannot delete activity that has ${clientCount} active client(s) associated.`,
                    400
                );
            }

            await prisma.economicActivity.update({
                where: { id },
                data: { isActive: false },
            });

            await bumpMasterDataVersion('economicActivities');
            await bumpMasterDataVersion('economicActivityTypes');
            return successResponse(null, 'Economic activity deleted successfully');
        } catch (error) {
            console.error('Error deleting economic activity:', error);
            return errorResponse('Failed to delete economic activity', 500);
        }
    })(request);
}
