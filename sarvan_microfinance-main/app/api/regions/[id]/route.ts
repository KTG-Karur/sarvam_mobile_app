import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { bumpMasterDataVersion } from '@/app/lib/cache/master-data-cache';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// GET /api/regions/[id]
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    return withRole(['ADMIN'], async () => {
        try {
            const { id } = await params;
            const region = await prisma.region.findUnique({
                where: { id },
                include: { _count: { select: { divisions: true } }, divisions: { orderBy: { name: 'asc' }, select: { id: true, name: true, code: true, isActive: true } } },
            });
            if (!region) return errorResponse('Region not found', 404);
            return successResponse(region, 'Region fetched successfully');
        } catch (error) {
            console.error(error);
            return errorResponse('Failed to fetch region', 500);
        }
    })(_request);
}

// PUT /api/regions/[id]
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const { id } = await params;
            const body = await req.json();
            const { name, code, isActive } = body;

            const existing = await prisma.region.findUnique({ where: { id } });
            if (!existing) return errorResponse('Region not found', 404);

            const updateData: Record<string, unknown> = {};
            if (name != null) updateData.name = String(name).trim();
            if (code != null) {
                const upperCode = String(code).trim().toUpperCase();
                const conflict = await prisma.region.findFirst({ where: { code: upperCode, NOT: { id } } });
                if (conflict) return errorResponse('Region code already exists', 409);
                updateData.code = upperCode;
            }
            if (isActive != null) updateData.isActive = Boolean(isActive);

            const updated = await prisma.region.update({
                where: { id },
                data: updateData,
                include: { _count: { select: { divisions: true } } },
            });

            await bumpMasterDataVersion('regions');
            return successResponse(updated, 'Region updated successfully');
        } catch (error) {
            console.error(error);
            return errorResponse('Failed to update region', 500);
        }
    })(request);
}

// DELETE /api/regions/[id]
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    return withRole(['ADMIN'], async () => {
        try {
            const { id } = await params;
            const linked = await prisma.region.findUnique({
                where: { id },
                select: { _count: { select: { divisions: true, transfersFromRegion: true, transfersToRegion: true } } },
            });
            if (!linked) return errorResponse('Region not found', 404);
            if (linked._count.divisions > 0) {
                return errorResponse(`Cannot delete: region has ${linked._count.divisions} division(s). Delete or reassign them first.`, 409);
            }
            if (linked._count.transfersFromRegion + linked._count.transfersToRegion > 0) {
                return errorResponse('Cannot delete: region is referenced by employee transfer records. Deactivate it instead.', 409);
            }

            await prisma.region.delete({ where: { id } });
            await bumpMasterDataVersion('regions');
            return successResponse({ id }, 'Region deleted successfully');
        } catch (error) {
            console.error(error);
            return errorResponse('Failed to delete region', 500);
        }
    })(request);
}
