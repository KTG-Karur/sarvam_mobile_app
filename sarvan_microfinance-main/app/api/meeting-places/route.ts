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

// GET /api/meeting-places
export async function GET(request: NextRequest) {
    return withRole(['ADMIN', 'BRANCH_MANAGER', 'FDO', 'AREA_MANAGER', 'QC', 'DIVISION_MANAGER'], async () => {
        try {
            const { searchParams } = new URL(request.url);
            const id = searchParams.get('id');
            const includeInactive = searchParams.get('includeInactive') === 'true';
            const search = searchParams.get('search');

            // ── Single record fetch ──
            if (id) {
                const meetingPlace = await prisma.meetingPlace.findUnique({ where: { id } });

                if (!meetingPlace) {
                    return errorResponse('Meeting place not found', 404);
                }

                return successResponse(meetingPlace, 'Meeting place fetched successfully');
            }

            // ── Build where clause for filtering ──
            const whereClause: any = includeInactive ? {} : { isActive: true };

            if (search) {
                whereClause.name = {
                    contains: search,
                    mode: 'insensitive',
                };
            }

            const fetchMeetingPlaces = () => prisma.meetingPlace.findMany({
                where: whereClause,
                orderBy: { name: 'asc' },
            });
            const meetingPlaces = search
                ? await fetchMeetingPlaces()
                : await cachedMasterData('meetingPlaces', stableParamsKey({ includeInactive }), fetchMeetingPlaces);

            return successResponse(meetingPlaces, 'Meeting places fetched successfully');
        } catch (error) {
            console.error('Error fetching meeting places:', error);
            return errorResponse('Failed to fetch meeting places', 500);
        }
    })(request);
}

// POST /api/meeting-places
export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async () => {
        try {
            const body = await request.json();

            if (!body.name?.trim()) {
                return errorResponse('Meeting place name is required', 400);
            }

            const normalizedName = body.name.trim();

            const existing = await prisma.meetingPlace.findFirst({
                where: {
                    name: {
                        equals: normalizedName,
                        mode: 'insensitive',
                    },
                    isActive: true,
                },
            });

            if (existing) {
                return errorResponse('Meeting place name already exists', 409);
            }

            const existingPlaces = await prisma.meetingPlace.findMany({
                select: { placeId: true },
                orderBy: { createdAt: 'desc' },
            });

            let nextNumber = 1;
            if (existingPlaces.length > 0) {
                const numbers = existingPlaces
                    .map((p) => {
                        const match = p.placeId.match(/MEETING-PLACE-(\d+)/);
                        return match ? parseInt(match[1], 10) : 0;
                    })
                    .filter((n) => n > 0);
                if (numbers.length > 0) {
                    nextNumber = Math.max(...numbers) + 1;
                }
            }
            const placeId = `MEETING-PLACE-${String(nextNumber).padStart(4, '0')}`;

            const meetingPlace = await prisma.meetingPlace.create({
                data: {
                    placeId,
                    name: normalizedName,
                    isActive: true,
                },
            });

            await bumpMasterDataVersion('meetingPlaces');
            return successResponse(meetingPlace, 'Meeting place created successfully', 201);
        } catch (error) {
            console.error('Error creating meeting place:', error);
            return errorResponse('Failed to create meeting place', 500);
        }
    })(request);
}

// PUT /api/meeting-places
export async function PUT(request: NextRequest) {
    return withRole(['ADMIN'], async () => {
        try {
            const body = await request.json();

            if (!body.id) {
                return errorResponse('Meeting place ID is required', 400);
            }

            if (!body.name?.trim()) {
                return errorResponse('Meeting place name is required', 400);
            }

            const existing = await prisma.meetingPlace.findUnique({
                where: { id: body.id },
            });

            if (!existing) {
                return errorResponse('Meeting place not found', 404);
            }

            const normalizedName = body.name.trim();

            const duplicate = await prisma.meetingPlace.findFirst({
                where: {
                    name: {
                        equals: normalizedName,
                        mode: 'insensitive',
                    },
                    id: { not: body.id },
                    isActive: true,
                },
            });

            if (duplicate) {
                return errorResponse('Meeting place name already exists', 409);
            }

            const updated = await prisma.meetingPlace.update({
                where: { id: body.id },
                data: { name: normalizedName },
            });

            await bumpMasterDataVersion('meetingPlaces');
            return successResponse(updated, 'Meeting place updated successfully');
        } catch (error) {
            console.error('Error updating meeting place:', error);
            return errorResponse('Failed to update meeting place', 500);
        }
    })(request);
}

// DELETE /api/meeting-places
export async function DELETE(request: NextRequest) {
    return withRole(['ADMIN'], async () => {
        try {
            const { searchParams } = new URL(request.url);
            const id = searchParams.get('id');

            if (!id) {
                return errorResponse('Meeting place ID is required', 400);
            }

            const existing = await prisma.meetingPlace.findUnique({ where: { id } });

            if (!existing) {
                return errorResponse('Meeting place not found', 404);
            }

            await prisma.meetingPlace.update({
                where: { id },
                data: { isActive: false },
            });

            await bumpMasterDataVersion('meetingPlaces');
            return successResponse(null, 'Meeting place deleted successfully');
        } catch (error) {
            console.error('Error deleting meeting place:', error);
            return errorResponse('Failed to delete meeting place', 500);
        }
    })(request);
}
