import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withRole, withAuth } from '@/app/lib/api-utils';
import { generateUniqueOrgCode } from '@/app/lib/services/org-code-generator';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// GET /api/areas — filter by divisionId optional
export async function GET(request: NextRequest) {
    return withAuth(async (req) => {
        try {
            const { searchParams } = new URL(req.url);
            const divisionId = searchParams.get('divisionId') || undefined;
            const includeInactive = searchParams.get('includeInactive') === 'true';

            const areas = await prisma.area.findMany({
                where: {
                    ...(includeInactive ? {} : { isActive: true }),
                    ...(divisionId ? { divisionId } : {}),
                },
                orderBy: { name: 'asc' },
                include: {
                    division: {
                        select: {
                            id: true, name: true, code: true,
                            region: { select: { id: true, name: true, code: true } },
                        },
                    },
                    _count: { select: { branches: true } },
                },
            });

            return successResponse(areas, 'Areas fetched successfully');
        } catch (error) {
            console.error('Error fetching areas:', error);
            return errorResponse('Failed to fetch areas', 500);
        }
    })(request);
}

// POST /api/areas — ADMIN only
export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const body = await req.json();
            const { name, code, divisionId } = body;

            if (!name?.trim()) return errorResponse('Area name is required', 400);
            if (!divisionId) return errorResponse('Division is required', 400);

            const division = await prisma.division.findUnique({ where: { id: divisionId } });
            if (!division) return errorResponse('Division not found', 404);

            let upperCode: string;
            if (code?.trim()) {
                upperCode = String(code).trim().toUpperCase();
                const existing = await prisma.area.findUnique({ where: { code: upperCode } });
                if (existing) return errorResponse('Area code already exists', 409);
            } else {
                upperCode = await generateUniqueOrgCode(
                    name,
                    async (candidate) => !!(await prisma.area.findUnique({ where: { code: candidate } })),
                    'ARE'
                );
            }

            const area = await prisma.area.create({
                data: { name: name.trim(), code: upperCode, divisionId },
                include: {
                    division: {
                        select: {
                            id: true, name: true, code: true,
                            region: { select: { id: true, name: true, code: true } },
                        },
                    },
                    _count: { select: { branches: true } },
                },
            });

            return successResponse(area, 'Area created successfully', 201);
        } catch (error) {
            console.error('Error creating area:', error);
            return errorResponse('Failed to create area', 500);
        }
    })(request);
}
