import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import * as XLSX from 'xlsx';
import { cachedMasterData, stableParamsKey, bumpMasterDataVersion } from '@/app/lib/cache/master-data-cache';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// GET /api/economic-activity-types
export async function GET(request: NextRequest) {
    return withRole(['ADMIN', 'BRANCH_MANAGER', 'FDO', 'AREA_MANAGER'], async () => {
        try {
            const { searchParams } = new URL(request.url);
            const id = searchParams.get('id');
            const includeInactive = searchParams.get('includeInactive') === 'true';
            const includeActivities = searchParams.get('includeActivities') === 'true';
            const search = searchParams.get('search');
            const includeCount = searchParams.get('includeCount') === 'true';

            // ── Single record fetch ──
            if (id) {
                const activityType = await prisma.economicActivityType.findUnique({
                    where: { id },
                    include: includeActivities ? {
                        economicActivities: {
                            where: { isActive: true },
                            orderBy: { name: 'asc' },
                        }
                    } : undefined,
                });

                if (!activityType) {
                    return errorResponse('Economic activity type not found', 404);
                }

                return successResponse(activityType, 'Activity type fetched successfully');
            }

            // ── Build where clause for filtering ──
            const whereClause: any = includeInactive ? {} : { isActive: true };

            // Add search filter if provided
            if (search) {
                whereClause.name = {
                    contains: search,
                    mode: 'insensitive',
                };
            }

            // ── Fetch all activity types with optional includes ──
            const fetchActivityTypes = () => prisma.economicActivityType.findMany({
                where: whereClause,
                include: includeActivities ? {
                    economicActivities: {
                        where: { isActive: true },
                        orderBy: { name: 'asc' },
                    }
                } : undefined,
                orderBy: { createdAt: 'desc' },
            });
            const activityTypes = search
                ? await fetchActivityTypes()
                : await cachedMasterData(
                    'economicActivityTypes',
                    stableParamsKey({ includeInactive, includeActivities }),
                    fetchActivityTypes
                );

            // ── If includeCount is true, add count of economicActivities to each record
            if (includeCount) {
                const activityTypesWithCount = await Promise.all(
                    activityTypes.map(async (type) => {
                        const count = await prisma.economicActivity.count({
                            where: {
                                economicActivityTypeId: type.id,
                                isActive: true,
                            },
                        });
                        return {
                            ...type,
                            _count: { economicActivities: count },
                        };
                    })
                );
                return successResponse(activityTypesWithCount, 'Activity types fetched successfully');
            }

            return successResponse(activityTypes, 'Activity types fetched successfully');
        } catch (error) {
            console.error('Error fetching economic activity types:', error);
            return errorResponse('Failed to fetch economic activity types', 500);
        }
    })(request);
}

// POST /api/economic-activity-types
export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async () => {
        try {
            const body = await request.json();

            if (!body.name?.trim()) {
                return errorResponse('Activity type name is required', 400);
            }

            const normalizedName = body.name.trim();

            const existingType = await prisma.economicActivityType.findFirst({
                where: {
                    name: {
                        equals: normalizedName,
                        mode: 'insensitive',
                    },
                    isActive: true,
                },
            });

            if (existingType) {
                return errorResponse('Activity type name already exists', 409);
            }

            const existingTypes = await prisma.economicActivityType.findMany({
                select: { typeId: true },
                orderBy: { createdAt: 'desc' },
            });

            let nextNumber = 1;
            if (existingTypes.length > 0) {
                const numbers = existingTypes
                    .map((t) => {
                        const match = t.typeId.match(/ACTIVITY-TYPE-(\d+)/);
                        return match ? parseInt(match[1], 10) : 0;
                    })
                    .filter((n) => n > 0);
                if (numbers.length > 0) {
                    nextNumber = Math.max(...numbers) + 1;
                }
            }
            const typeId = `ACTIVITY-TYPE-${String(nextNumber).padStart(4, '0')}`;

            const activityType = await prisma.economicActivityType.create({
                data: {
                    typeId,
                    name: normalizedName,
                    description: body.description || null,
                    isActive: true,
                },
            });

            await bumpMasterDataVersion('economicActivityTypes');
            await bumpMasterDataVersion('economicActivities'); // embeds the type object when includeType is requested
            return successResponse(activityType, 'Economic activity type created successfully', 201);
        } catch (error) {
            console.error('Error creating economic activity type:', error);
            return errorResponse('Failed to create economic activity type', 500);
        }
    })(request);
}

// PUT /api/economic-activity-types
export async function PUT(request: NextRequest) {
    return withRole(['ADMIN'], async () => {
        try {
            const body = await request.json();

            if (!body.id) {
                return errorResponse('Activity type ID is required', 400);
            }

            if (!body.name?.trim()) {
                return errorResponse('Activity type name is required', 400);
            }

            const existingType = await prisma.economicActivityType.findUnique({
                where: { id: body.id },
            });

            if (!existingType) {
                return errorResponse('Economic activity type not found', 404);
            }

            const normalizedName = body.name.trim();

            const duplicateType = await prisma.economicActivityType.findFirst({
                where: {
                    name: {
                        equals: normalizedName,
                        mode: 'insensitive',
                    },
                    id: { not: body.id },
                    isActive: true,
                },
            });

            if (duplicateType) {
                return errorResponse('Activity type name already exists', 409);
            }

            const updatedType = await prisma.economicActivityType.update({
                where: { id: body.id },
                data: {
                    name: normalizedName,
                    description: body.description || null,
                },
            });

            await bumpMasterDataVersion('economicActivityTypes');
            await bumpMasterDataVersion('economicActivities');
            return successResponse(updatedType, 'Economic activity type updated successfully');
        } catch (error) {
            console.error('Error updating economic activity type:', error);
            return errorResponse('Failed to update economic activity type', 500);
        }
    })(request);
}

// DELETE /api/economic-activity-types
export async function DELETE(request: NextRequest) {
    return withRole(['ADMIN'], async () => {
        try {
            const { searchParams } = new URL(request.url);
            const id = searchParams.get('id');

            if (!id) {
                return errorResponse('Activity type ID is required', 400);
            }

            const existingType = await prisma.economicActivityType.findUnique({
                where: { id },
                include: {
                    economicActivities: {
                        where: { isActive: true },
                        select: { id: true },
                        take: 1,
                    },
                },
            });

            if (!existingType) {
                return errorResponse('Economic activity type not found', 404);
            }

            if (existingType.economicActivities.length > 0) {
                return errorResponse(
                    'Cannot delete activity type that has active economic activities. Please reassign activities first.',
                    400
                );
            }

            await prisma.economicActivityType.update({
                where: { id },
                data: { isActive: false },
            });

            await bumpMasterDataVersion('economicActivityTypes');
            await bumpMasterDataVersion('economicActivities');
            return successResponse(null, 'Economic activity type deleted successfully');
        } catch (error) {
            console.error('Error deleting economic activity type:', error);
            return errorResponse('Failed to delete economic activity type', 500);
        }
    })(request);
}
