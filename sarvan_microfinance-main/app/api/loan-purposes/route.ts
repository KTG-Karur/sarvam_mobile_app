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

// GET /api/loan-purposes
export async function GET(request: NextRequest) {
    return withRole(['ADMIN', 'BRANCH_MANAGER', 'FDO', 'AREA_MANAGER', 'QC'], async () => {
        try {
            const { searchParams } = new URL(request.url);
            const id = searchParams.get('id');
            const purposeTypeId = searchParams.get('purposeTypeId');
            const includeInactive = searchParams.get('includeInactive') === 'true';
            const includeType = searchParams.get('includeType') === 'true';
            const search = searchParams.get('search');
            const includeCount = searchParams.get('includeCount') === 'true';

            // ── Single record fetch ──
            if (id) {
                const loanPurpose = await prisma.loanPurpose.findUnique({
                    where: { id },
                    include: includeType ? { 
                        loanPurposeType: true 
                    } : undefined,
                });

                if (!loanPurpose) {
                    return errorResponse('Loan purpose not found', 404);
                }

                return successResponse(loanPurpose, 'Loan purpose fetched successfully');
            }

            // ── Build where clause for filtering ──
            const whereClause: any = includeInactive ? {} : { isActive: true };
            
            // Add purpose type filter if provided
            if (purposeTypeId && purposeTypeId !== 'all') {
                whereClause.loanPurposeTypeId = purposeTypeId;
            }
            
            // Add search filter if provided
            if (search) {
                whereClause.name = {
                    contains: search,
                    mode: 'insensitive',
                };
            }

            // ── Fetch all loan purposes with optional includes ──
            // Only the base list is cached — the loan.count enrichment below always
            // runs live afterward (never part of the cached payload), and `search`
            // bypasses the cache entirely (too many distinct free-text values for a
            // useful hit rate).
            const fetchLoanPurposes = () => prisma.loanPurpose.findMany({
                where: whereClause,
                include: includeType ? {
                    loanPurposeType: true
                } : undefined,
                orderBy: { name: 'asc' },
            });
            const loanPurposes = search
                ? await fetchLoanPurposes()
                : await cachedMasterData(
                    'loanPurposes',
                    stableParamsKey({ includeInactive, purposeTypeId: purposeTypeId ?? null, includeType }),
                    fetchLoanPurposes
                );

            // ── If includeCount is true, add count of loans to each record
            if (includeCount) {
                const loanPurposesWithCount = await Promise.all(
                    loanPurposes.map(async (purpose) => {
                        const count = await prisma.loan.count({
                            where: {
                                loanPurposeId: purpose.id,
                                isActive: true,
                            },
                        });
                        return {
                            ...purpose,
                            _count: { loans: count },
                        };
                    })
                );
                return successResponse(loanPurposesWithCount, 'Loan purposes fetched successfully');
            }

            return successResponse(loanPurposes, 'Loan purposes fetched successfully');
        } catch (error) {
            console.error('Error fetching loan purposes:', error);
            return errorResponse('Failed to fetch loan purposes', 500);
        }
    })(request);
}

// POST /api/loan-purposes
export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async () => {
        try {
            const body = await request.json();

            // ── Validation ──
            if (!body.name?.trim()) {
                return errorResponse('Purpose name is required', 400);
            }

            if (!body.loanPurposeTypeId) {
                return errorResponse('Purpose type is required', 400);
            }

            // ── Verify purpose type exists and is active ──
            const purposeType = await prisma.loanPurposeType.findUnique({
                where: { id: body.loanPurposeTypeId, isActive: true },
            });

            if (!purposeType) {
                return errorResponse('Invalid or inactive purpose type selected', 400);
            }

            const normalizedName = body.name.trim();

            // ── Check for duplicate within the same purpose type (composite unique constraint) ──
            const existingPurpose = await prisma.loanPurpose.findFirst({
                where: {
                    loanPurposeTypeId: body.loanPurposeTypeId,
                    name: {
                        equals: normalizedName,
                        mode: 'insensitive',
                    },
                    isActive: true,
                },
            });

            if (existingPurpose) {
                return errorResponse(`Purpose name "${normalizedName}" already exists under this purpose type`, 409);
            }

            // ── Generate purposeId (e.g., PURPOSE-0001, PURPOSE-0002) ──
            const existingPurposes = await prisma.loanPurpose.findMany({
                select: { purposeId: true },
                orderBy: { createdAt: 'desc' },
            });

            let nextNumber = 1;
            if (existingPurposes.length > 0) {
                const numbers = existingPurposes
                    .map((p) => {
                        const match = p.purposeId.match(/PURPOSE-(\d+)/);
                        return match ? parseInt(match[1], 10) : 0;
                    })
                    .filter((n) => n > 0);
                if (numbers.length > 0) {
                    nextNumber = Math.max(...numbers) + 1;
                }
            }
            const purposeId = `PURPOSE-${String(nextNumber).padStart(4, '0')}`;

            // ── Create the loan purpose ──
            const loanPurpose = await prisma.loanPurpose.create({
                data: {
                    purposeId,
                    name: normalizedName,
                    loanPurposeTypeId: body.loanPurposeTypeId,
                    isActive: true,
                },
                include: { 
                    loanPurposeType: true 
                },
            });

            await bumpMasterDataVersion('loanPurposes');
            await bumpMasterDataVersion('loanPurposeTypes'); // embeds purposes when includePurposes/includeCount is requested
            return successResponse(loanPurpose, 'Loan purpose created successfully', 201);
        } catch (error) {
            console.error('Error creating loan purpose:', error);
            return errorResponse('Failed to create loan purpose', 500);
        }
    })(request);
}

// PUT /api/loan-purposes
export async function PUT(request: NextRequest) {
    return withRole(['ADMIN'], async () => {
        try {
            const body = await request.json();

            // ── Validation ──
            if (!body.id) {
                return errorResponse('Purpose ID is required', 400);
            }

            if (!body.name?.trim()) {
                return errorResponse('Purpose name is required', 400);
            }

            // ── Check if the purpose exists ──
            const existingPurpose = await prisma.loanPurpose.findUnique({
                where: { id: body.id },
                include: { loanPurposeType: true },
            });

            if (!existingPurpose) {
                return errorResponse('Loan purpose not found', 404);
            }

            const normalizedName = body.name.trim();
            
            // ── Determine which purpose type to use (new or existing) ──
            const purposeTypeId = body.loanPurposeTypeId || existingPurpose.loanPurposeTypeId;

            // ── Verify purpose type exists and is active (if being changed) ──
            if (body.loanPurposeTypeId && body.loanPurposeTypeId !== existingPurpose.loanPurposeTypeId) {
                const purposeType = await prisma.loanPurposeType.findUnique({
                    where: { id: body.loanPurposeTypeId, isActive: true },
                });
                if (!purposeType) {
                    return errorResponse('Invalid or inactive purpose type selected', 400);
                }
            }

            // ── Check for duplicate within the same purpose type (excluding current record) ──
            const duplicatePurpose = await prisma.loanPurpose.findFirst({
                where: {
                    loanPurposeTypeId: purposeTypeId,
                    name: {
                        equals: normalizedName,
                        mode: 'insensitive',
                    },
                    id: { not: body.id },
                    isActive: true,
                },
            });

            if (duplicatePurpose) {
                return errorResponse(`Purpose name "${normalizedName}" already exists under this purpose type`, 409);
            }

            // ── Prepare update data ──
            const updateData: any = {
                name: normalizedName,
            };

            // Only update purpose type if provided
            if (body.loanPurposeTypeId) {
                updateData.loanPurposeTypeId = body.loanPurposeTypeId;
            }

            // ── Update the loan purpose ──
            const updatedPurpose = await prisma.loanPurpose.update({
                where: { id: body.id },
                data: updateData,
                include: { 
                    loanPurposeType: true 
                },
            });

            await bumpMasterDataVersion('loanPurposes');
            await bumpMasterDataVersion('loanPurposeTypes');
            return successResponse(updatedPurpose, 'Loan purpose updated successfully');
        } catch (error) {
            console.error('Error updating loan purpose:', error);
            return errorResponse('Failed to update loan purpose', 500);
        }
    })(request);
}

// DELETE /api/loan-purposes
export async function DELETE(request: NextRequest) {
    return withRole(['ADMIN'], async () => {
        try {
            const { searchParams } = new URL(request.url);
            const id = searchParams.get('id');

            if (!id) {
                return errorResponse('Purpose ID is required', 400);
            }

            const existingPurpose = await prisma.loanPurpose.findUnique({
                where: { id },
                include: {
                    loans: {
                        where: { isActive: true },
                        select: { id: true },
                        take: 1,
                    },
                },
            });

            if (!existingPurpose) {
                return errorResponse('Loan purpose not found', 404);
            }

            if (existingPurpose.loans.length > 0) {
                return errorResponse(
                    'Cannot delete purpose that has active loans. Please reassign loans first.',
                    400
                );
            }

            await prisma.loanPurpose.update({
                where: { id },
                data: { isActive: false },
            });

            await bumpMasterDataVersion('loanPurposes');
            await bumpMasterDataVersion('loanPurposeTypes');
            return successResponse(null, 'Loan purpose deleted successfully');
        } catch (error) {
            console.error('Error deleting loan purpose:', error);
            return errorResponse('Failed to delete loan purpose', 500);
        }
    })(request);
}