import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withRole, withAuth } from '@/app/lib/api-utils';
import { cachedMasterData, stableParamsKey, bumpMasterDataVersion } from '@/app/lib/cache/master-data-cache';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// GET /api/regions — all authenticated roles can read
export async function GET(request: NextRequest) {
    return withAuth(async (req) => {
        try {
            const { searchParams } = new URL(req.url);
            const includeInactive = searchParams.get('includeInactive') === 'true';

            const regions = await cachedMasterData(
                'regions',
                stableParamsKey({ includeInactive }),
                () => prisma.region.findMany({
                    where: includeInactive ? undefined : { isActive: true },
                    orderBy: { name: 'asc' },
                    include: { _count: { select: { divisions: true } } },
                })
            );

            return successResponse(regions, 'Regions fetched successfully');
        } catch (error) {
            console.error('Error fetching regions:', error);
            return errorResponse('Failed to fetch regions', 500);
        }
    })(request);
}

// POST /api/regions — ADMIN only
export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const body = await req.json();
            const { name, code } = body;

            if (!name?.trim()) return errorResponse('Region name is required', 400);
            if (!code?.trim()) return errorResponse('Region code is required', 400);

            const upperCode = String(code).trim().toUpperCase();

            const existing = await prisma.region.findUnique({ where: { code: upperCode } });
            if (existing) return errorResponse('Region code already exists', 409);

            const region = await prisma.region.create({
                data: { name: name.trim(), code: upperCode },
                include: { _count: { select: { divisions: true } } },
            });

            await bumpMasterDataVersion('regions');
            return successResponse(region, 'Region created successfully', 201);
        } catch (error) {
            console.error('Error creating region:', error);
            return errorResponse('Failed to create region', 500);
        }
    })(request);
}
