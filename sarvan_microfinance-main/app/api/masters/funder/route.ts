import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { cachedMasterData, bumpMasterDataVersion } from '@/app/lib/cache/master-data-cache';

/**
 * OPTIONS /api/masters/funder
 */
export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/masters/funder
 * Fetch all funders
 */
export async function GET(request: NextRequest) {
    return withAuth(async () => {
        try {
            const funders = await cachedMasterData('funders', 'all', () =>
                prisma.funder.findMany({
                    where: {
                        isActive: true,
                    },
                    include: {
                        principalGL: true,
                        interestGL: true,
                    },
                    orderBy: {
                        createdAt: 'desc',
                    },
                })
            );

            return successResponse(funders, 'Funders fetched successfully');
        } catch (error) {
            console.error('Error fetching funders:', error);
            return successResponse([], 'Funder Registry is currently empty or initializing.');
        }
    })(request);
}

/**
 * POST /api/masters/funder
 * Create a new funder
 */
export async function POST(request: NextRequest) {
    return withAuth(async () => {
        try {
            const body = await request.json();

            // Handle potential field name mismatch between frontend (principleGL) and schema (principalGLId)
            const funderName = body.funderName;
            const principalGLId = body.principleGL || body.principalGLId;
            const interestGLId = body.interestGL || body.interestGLId;

            if (!funderName || !principalGLId || !interestGLId) {
                return errorResponse('Funder Name, Principal GL, and Interest GL are required', 400);
            }

            // Generate funderId if not provided or empty
            let funderId = body.funderId;
            if (!funderId || funderId.trim() === '') {
                const count = await prisma.funder.count();
                funderId = (1001 + count).toString();
            }

            const funder = await prisma.funder.create({
                data: {
                    funderId,
                    funderName,
                    principalGLId,
                    interestGLId,
                    interestPercent: body.interestPercent || 0,
                    tdsPercent: body.tdsPercent || 0,
                },
            });

            await bumpMasterDataVersion('funders');
            return successResponse(funder, 'Funder created successfully', 201);
        } catch (error) {
            console.error('Error creating funder:', error);
            return errorResponse('Failed to create funder', 500);
        }
    })(request);
}

/**
 * PUT /api/masters/funder
 * Update a funder
 */
export async function PUT(request: NextRequest) {
    return withAuth(async () => {
        try {
            const body = await request.json();

            if (!body.funderId) {
                return errorResponse('Funder ID is required', 400);
            }

            const funder = await prisma.funder.update({
                where: { funderId: body.funderId },
                data: {
                    funderName: body.funderName,
                    principalGLId: body.principleGL || body.principalGLId,
                    interestGLId: body.interestGL || body.interestGLId,
                    interestPercent: body.interestPercent,
                    tdsPercent: body.tdsPercent,
                },
            });

            await bumpMasterDataVersion('funders');
            return successResponse(funder, 'Funder updated successfully');
        } catch (error) {
            console.error('Error updating funder:', error);
            return errorResponse('Failed to update funder', 500);
        }
    })(request);
}

/**
 * DELETE /api/masters/funder
 * Soft delete a funder
 */
export async function DELETE(request: NextRequest) {
    return withAuth(async () => {
        try {
            const { searchParams } = new URL(request.url);
            const funderId = searchParams.get('funderId');

            if (!funderId) {
                return errorResponse('Funder ID is required', 400);
            }

            await prisma.funder.update({
                where: { funderId },
                data: { isActive: false },
            });

            await bumpMasterDataVersion('funders');
            return successResponse(null, 'Funder deleted successfully');
        } catch (error) {
            console.error('Error deleting funder:', error);
            return errorResponse('Failed to delete funder', 500);
        }
    })(request);
}
