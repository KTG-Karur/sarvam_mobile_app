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

// GET /api/loan-purpose-types
export async function GET(request: NextRequest) {
    return withRole(['ADMIN', 'BRANCH_MANAGER','FDO','AREA_MANAGER'], async () => {
        try {
            const { searchParams } = new URL(request.url);
            const id = searchParams.get('id');
            const includeInactive = searchParams.get('includeInactive') === 'true';
            const includePurposes = searchParams.get('includePurposes') === 'true';
            const search = searchParams.get('search');
            const includeCount = searchParams.get('includeCount') === 'true';

            // ── Single record fetch ──
            if (id) {
                const purposeType = await prisma.loanPurposeType.findUnique({
                    where: { id },
                    include: includePurposes ? {
                        loanPurposes: {
                            where: { isActive: true },
                            orderBy: { name: 'asc' },
                        }
                    } : undefined,
                });

                if (!purposeType) {
                    return errorResponse('Loan purpose type not found', 404);
                }

                return successResponse(purposeType, 'Purpose type fetched successfully');
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

            // ── Fetch all purpose types with optional includes ──
            const fetchPurposeTypes = () => prisma.loanPurposeType.findMany({
                where: whereClause,
                include: includePurposes ? {
                    loanPurposes: {
                        where: { isActive: true },
                        orderBy: { name: 'asc' },
                    }
                } : undefined,
                orderBy: { createdAt: 'desc' },
            });
            const purposeTypes = search
                ? await fetchPurposeTypes()
                : await cachedMasterData(
                    'loanPurposeTypes',
                    stableParamsKey({ includeInactive, includePurposes }),
                    fetchPurposeTypes
                );

            // ── If includeCount is true, add count of loanPurposes to each record
            if (includeCount) {
                const purposeTypesWithCount = await Promise.all(
                    purposeTypes.map(async (type) => {
                        const count = await prisma.loanPurpose.count({
                            where: {
                                loanPurposeTypeId: type.id,
                                isActive: true,
                            },
                        });
                        return {
                            ...type,
                            _count: { loanPurposes: count },
                        };
                    })
                );
                return successResponse(purposeTypesWithCount, 'Purpose types fetched successfully');
            }

            return successResponse(purposeTypes, 'Purpose types fetched successfully');
        } catch (error) {
            console.error('Error fetching loan purpose types:', error);
            return errorResponse('Failed to fetch loan purpose types', 500);
        }
    })(request);
}

// POST /api/loan-purpose-types
export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async () => {
        try {
            const body = await request.json();

            if (!body.name?.trim()) {
                return errorResponse('Purpose type name is required', 400);
            }

            const normalizedName = body.name.trim();

            const existingType = await prisma.loanPurposeType.findFirst({
                where: {
                    name: {
                        equals: normalizedName,
                        mode: 'insensitive',
                    },
                    isActive: true,
                },
            });

            if (existingType) {
                return errorResponse('Purpose type name already exists', 409);
            }

            const existingTypes = await prisma.loanPurposeType.findMany({
                select: { typeId: true },
                orderBy: { createdAt: 'desc' },
            });

            let nextNumber = 1;
            if (existingTypes.length > 0) {
                const numbers = existingTypes
                    .map((t) => {
                        const match = t.typeId.match(/PURPOSE-TYPE-(\d+)/);
                        return match ? parseInt(match[1], 10) : 0;
                    })
                    .filter((n) => n > 0);
                if (numbers.length > 0) {
                    nextNumber = Math.max(...numbers) + 1;
                }
            }
            const typeId = `PURPOSE-TYPE-${String(nextNumber).padStart(4, '0')}`;

            const purposeType = await prisma.loanPurposeType.create({
                data: {
                    typeId,
                    name: normalizedName,
                    description: body.description || null,
                    isActive: true,
                },
            });

            await bumpMasterDataVersion('loanPurposeTypes');
            await bumpMasterDataVersion('loanPurposes'); // embeds the type object when includeType is requested
            return successResponse(purposeType, 'Loan purpose type created successfully', 201);
        } catch (error) {
            console.error('Error creating loan purpose type:', error);
            return errorResponse('Failed to create loan purpose type', 500);
        }
    })(request);
}

// PUT /api/loan-purpose-types
export async function PUT(request: NextRequest) {
    return withRole(['ADMIN'], async () => {
        try {
            const body = await request.json();

            if (!body.id) {
                return errorResponse('Purpose type ID is required', 400);
            }

            if (!body.name?.trim()) {
                return errorResponse('Purpose type name is required', 400);
            }

            const existingType = await prisma.loanPurposeType.findUnique({
                where: { id: body.id },
            });

            if (!existingType) {
                return errorResponse('Loan purpose type not found', 404);
            }

            const normalizedName = body.name.trim();

            const duplicateType = await prisma.loanPurposeType.findFirst({
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
                return errorResponse('Purpose type name already exists', 409);
            }

            const updatedType = await prisma.loanPurposeType.update({
                where: { id: body.id },
                data: {
                    name: normalizedName,
                    description: body.description || null,
                },
            });

            await bumpMasterDataVersion('loanPurposeTypes');
            await bumpMasterDataVersion('loanPurposes');
            return successResponse(updatedType, 'Loan purpose type updated successfully');
        } catch (error) {
            console.error('Error updating loan purpose type:', error);
            return errorResponse('Failed to update loan purpose type', 500);
        }
    })(request);
}

// DELETE /api/loan-purpose-types
export async function DELETE(request: NextRequest) {
    return withRole(['ADMIN'], async () => {
        try {
            const { searchParams } = new URL(request.url);
            const id = searchParams.get('id');

            if (!id) {
                return errorResponse('Purpose type ID is required', 400);
            }

            const existingType = await prisma.loanPurposeType.findUnique({
                where: { id },
                include: {
                    loanPurposes: {
                        where: { isActive: true },
                        select: { id: true },
                        take: 1,
                    },
                },
            });

            if (!existingType) {
                return errorResponse('Loan purpose type not found', 404);
            }

            if (existingType.loanPurposes.length > 0) {
                return errorResponse(
                    'Cannot delete purpose type that has active loan purposes. Please reassign purposes first.',
                    400
                );
            }

            await prisma.loanPurposeType.update({
                where: { id },
                data: { isActive: false },
            });

            await bumpMasterDataVersion('loanPurposeTypes');
            await bumpMasterDataVersion('loanPurposes');
            return successResponse(null, 'Loan purpose type deleted successfully');
        } catch (error) {
            console.error('Error deleting loan purpose type:', error);
            return errorResponse('Failed to delete loan purpose type', 500);
        }
    })(request);
}