import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withRole, withAuth } from '@/app/lib/api-utils';
import { generateUniqueOrgCode } from '@/app/lib/services/org-code-generator';
import { bumpMasterDataVersion } from '@/app/lib/cache/master-data-cache';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// GET /api/divisions — filter by regionId optional
export async function GET(request: NextRequest) {
    return withAuth(async (req) => {
        try {
            const { searchParams } = new URL(req.url);
            const regionId = searchParams.get('regionId') || undefined;
            const includeInactive = searchParams.get('includeInactive') === 'true';

            const divisions = await prisma.division.findMany({
                where: {
                    ...(includeInactive ? {} : { isActive: true }),
                    ...(regionId ? { regionId } : {}),
                },
                orderBy: { name: 'asc' },
                include: {
                    region: { select: { id: true, name: true, code: true } },
                    _count: { select: { areas: true } },
                    managers: {
                        select: { id: true, firstName: true, lastName: true, employeeId: true },
                        where: { role: 'DIVISION_MANAGER' },
                    },
                },
            });

            return successResponse(divisions, 'Divisions fetched successfully');
        } catch (error) {
            console.error('Error fetching divisions:', error);
            return errorResponse('Failed to fetch divisions', 500);
        }
    })(request);
}

// POST /api/divisions — ADMIN only
export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const body = await req.json();
            const { name, code, regionId, managerId } = body;

            if (!name?.trim()) return errorResponse('Division name is required', 400);
            if (!regionId) return errorResponse('Region is required', 400);

            const region = await prisma.region.findUnique({ where: { id: regionId } });
            if (!region) return errorResponse('Region not found', 404);

            let upperCode: string;
            if (code?.trim()) {
                upperCode = String(code).trim().toUpperCase();
                const existing = await prisma.division.findUnique({ where: { code: upperCode } });
                if (existing) return errorResponse('Division code already exists', 409);
            } else {
                upperCode = await generateUniqueOrgCode(
                    name,
                    async (candidate) => !!(await prisma.division.findUnique({ where: { code: candidate } })),
                    'DIV'
                );
            }

            const division = await prisma.$transaction(async (tx) => {
                const created = await tx.division.create({
                    data: { name: name.trim(), code: upperCode, regionId },
                });
                if (managerId) {
                    await tx.user.update({
                        where: { id: managerId },
                        data: { divisionId: created.id, role: 'DIVISION_MANAGER' },
                    });
                }
                return tx.division.findUnique({
                    where: { id: created.id },
                    include: {
                        region: { select: { id: true, name: true, code: true } },
                        _count: { select: { areas: true } },
                        managers: { select: { id: true, firstName: true, lastName: true } },
                    },
                });
            });

            await bumpMasterDataVersion('regions'); // region._count.divisions changed
            return successResponse(division, 'Division created successfully', 201);
        } catch (error) {
            console.error('Error creating division:', error);
            return errorResponse('Failed to create division', 500);
        }
    })(request);
}
