import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const assignmentSchema = z.object({
    roleSlug: z.string().min(1, 'Role slug is required'),
    itemName: z.string().min(1, 'Item name is required'),
    active: z.boolean(),
});

const descriptionUpdateSchema = z.object({
    itemName: z.string().min(1, 'Item name is required'),
    description: z.string().nullable(),
});

const bulkCatalogSchema = z.object({
    assignments: z.array(assignmentSchema).default([]),
    // Description is edited once per item name in the matrix (which spans all
    // roles for that name), so a change here applies to every role's row for
    // that name rather than a single role+item pair.
    descriptions: z.array(descriptionUpdateSchema).default([]),
});

// PUT /api/hr/belongings/catalog/bulk
export async function PUT(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const body = await req.json();
            const { assignments, descriptions } = bulkCatalogSchema.parse(body);

            const result = await prisma.$transaction(async (tx) => {
                let activated = 0;
                let deactivated = 0;
                let unchanged = 0;
                let descriptionsUpdated = 0;

                for (const assignment of assignments) {
                    const trimmedName = assignment.itemName.trim();
                    const trimmedRole = assignment.roleSlug.trim();

                    // Find existing records (active and inactive) for this role and item name (case-insensitive)
                    const existingItems = await tx.employeeBelongingItem.findMany({
                        where: {
                            roleSlug: trimmedRole,
                            itemName: { equals: trimmedName, mode: 'insensitive' },
                        },
                    });

                    const activeItem = existingItems.find((i) => i.isActive);
                    const inactiveItem = existingItems.find((i) => !i.isActive);

                    if (assignment.active) {
                        if (activeItem) {
                            // Already active - nothing to change
                            unchanged++;
                        } else if (inactiveItem) {
                            // Reactivate inactive record
                            await tx.employeeBelongingItem.update({
                                where: { id: inactiveItem.id },
                                data: { isActive: true },
                            });
                            activated++;
                        } else {
                            // No row exists - create new active item
                            await tx.employeeBelongingItem.create({
                                data: {
                                    roleSlug: trimmedRole,
                                    itemName: trimmedName,
                                    description: null,
                                    isActive: true,
                                },
                            });
                            activated++;
                        }
                    } else {
                        // Cell is unticked (active = false)
                        if (activeItem) {
                            // Deactivate active record (never hard delete)
                            await tx.employeeBelongingItem.update({
                                where: { id: activeItem.id },
                                data: { isActive: false },
                            });
                            deactivated++;
                        } else {
                            // Inactive or doesn't exist - unchanged
                            unchanged++;
                        }
                    }
                }

                for (const update of descriptions) {
                    const trimmedName = update.itemName.trim();
                    const res = await tx.employeeBelongingItem.updateMany({
                        where: { itemName: { equals: trimmedName, mode: 'insensitive' } },
                        data: { description: update.description?.trim() || null },
                    });
                    if (res.count > 0) descriptionsUpdated++;
                }

                return { activated, deactivated, unchanged, descriptionsUpdated };
            });

            return successResponse(result, 'Belonging catalog assignments updated successfully');
        } catch (error: unknown) {
            if (error instanceof z.ZodError) {
                return errorResponse(error.errors[0].message, 400);
            }
            console.error('Error updating bulk belonging catalog:', error);
            const message = error instanceof Error ? error.message : 'Failed to update catalog assignments';
            return errorResponse(message, 500);
        }
    })(request);
}

