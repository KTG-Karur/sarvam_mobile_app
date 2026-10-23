import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { bumpMasterDataVersion } from '@/app/lib/cache/master-data-cache';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// PUT /api/divisions/[id]
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const { id } = await params;
            const body = await req.json();
            const { name, code, regionId, isActive, managerId } = body;

            const existing = await prisma.division.findUnique({ where: { id } });
            if (!existing) return errorResponse('Division not found', 404);

            const updateData: Record<string, unknown> = {};
            if (name != null) updateData.name = String(name).trim();
            if (isActive != null) updateData.isActive = Boolean(isActive);
            if (regionId != null) updateData.regionId = regionId;
            if (code != null) {
                const upperCode = String(code).trim().toUpperCase();
                const conflict = await prisma.division.findFirst({ where: { code: upperCode, NOT: { id } } });
                if (conflict) return errorResponse('Division code already exists', 409);
                updateData.code = upperCode;
            }

            // Assign Division Manager: unset previous manager for this division, then set new one
            if (managerId !== undefined) {
                await prisma.$transaction(async (tx) => {
                    // Remove existing DM assignment for this division
                    await tx.user.updateMany({
                        where: { divisionId: id, role: 'DIVISION_MANAGER' },
                        data: { divisionId: null },
                    });
                    // Assign new manager if provided
                    if (managerId) {
                        await tx.user.update({
                            where: { id: managerId },
                            data: { divisionId: id, role: 'DIVISION_MANAGER' },
                        });
                    }
                    await tx.division.update({ where: { id }, data: updateData });
                });
            } else {
                await prisma.division.update({ where: { id }, data: updateData });
            }

            const updated = await prisma.division.findUnique({
                where: { id },
                include: {
                    region: { select: { id: true, name: true, code: true } },
                    _count: { select: { areas: true } },
                    managers: { select: { id: true, firstName: true, lastName: true } },
                },
            });

            if (regionId != null) await bumpMasterDataVersion('regions'); // region._count.divisions may have changed
            return successResponse(updated, 'Division updated successfully');
        } catch (error) {
            console.error(error);
            return errorResponse('Failed to update division', 500);
        }
    })(request);
}

// DELETE /api/divisions/[id]
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    return withRole(['ADMIN'], async () => {
        try {
            const { id } = await params;
            const linked = await prisma.division.findUnique({
                where: { id },
                select: { _count: { select: { areas: true, managers: true } } },
            });
            if (!linked) return errorResponse('Division not found', 404);
            if (linked._count.areas > 0) {
                return errorResponse(`Cannot delete: division has ${linked._count.areas} area(s). Delete or reassign them first.`, 409);
            }
            if (linked._count.managers > 0) {
                return errorResponse('Cannot delete: division has an assigned Division Manager. Unassign the manager first.', 409);
            }

            await prisma.division.delete({ where: { id } });
            await bumpMasterDataVersion('regions'); // region._count.divisions changed
            return successResponse({ id }, 'Division deleted successfully');
        } catch (error) {
            console.error(error);
            return errorResponse('Failed to delete division', 500);
        }
    })(request);
}
