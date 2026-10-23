import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { bumpMasterDataVersion } from '@/app/lib/cache/master-data-cache';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// PUT /api/areas/[id]
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const { id } = await params;
            const body = await req.json();
            const { name, code, divisionId, isActive } = body;

            const existing = await prisma.area.findUnique({ where: { id } });
            if (!existing) return errorResponse('Area not found', 404);

            const updateData: Record<string, unknown> = {};
            if (name != null) updateData.name = String(name).trim();
            if (isActive != null) updateData.isActive = Boolean(isActive);
            if (divisionId != null) updateData.divisionId = divisionId;
            if (code != null) {
                const upperCode = String(code).trim().toUpperCase();
                const conflict = await prisma.area.findFirst({ where: { code: upperCode, NOT: { id } } });
                if (conflict) return errorResponse('Area code already exists', 409);
                updateData.code = upperCode;
            }

            const updated = await prisma.area.update({
                where: { id },
                data: updateData,
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

            // Branch GET embeds { id, name, code } for each of its areas — a rename here
            // (or a divisionId reassignment) must bust that cache too.
            await bumpMasterDataVersion('branches');
            return successResponse(updated, 'Area updated successfully');
        } catch (error) {
            console.error(error);
            return errorResponse('Failed to update area', 500);
        }
    })(request);
}

// DELETE /api/areas/[id]
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    return withRole(['ADMIN'], async () => {
        try {
            const { id } = await params;
            const linked = await prisma.area.findUnique({
                where: { id },
                select: { _count: { select: { branches: true, transfersFromArea: true, transfersToArea: true } } },
            });
            if (!linked) return errorResponse('Area not found', 404);
            if (linked._count.branches > 0) {
                return errorResponse(`Cannot delete: area has ${linked._count.branches} branch(es) linked. Unlink them first.`, 409);
            }
            if (linked._count.transfersFromArea + linked._count.transfersToArea > 0) {
                return errorResponse('Cannot delete: area is referenced by employee transfer records. Deactivate it instead.', 409);
            }

            await prisma.area.delete({ where: { id } });
            await bumpMasterDataVersion('branches');
            return successResponse({ id }, 'Area deleted successfully');
        } catch (error) {
            console.error(error);
            return errorResponse('Failed to delete area', 500);
        }
    })(request);
}
