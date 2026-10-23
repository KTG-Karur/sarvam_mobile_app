import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { handleCorsPreflight, errorResponse, successResponse, withAuth, withRole } from '@/app/lib/api-utils';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const belongingItemSchema = z.object({
    roleSlug: z.string().trim().min(1, 'Role is required'),
    itemName: z.string().trim().min(1, 'Item name is required'),
    description: z.string().optional().nullable(),
    isActive: z.boolean().optional(),
});

// GET /api/hr/belongings/catalog?roleSlug=
export async function GET(request: NextRequest) {
    return withAuth(async (req) => {
        try {
            const { searchParams } = new URL(req.url);
            const roleSlug = searchParams.get('roleSlug');
            const includeInactive = searchParams.get('includeInactive') === 'true';

            const items = await prisma.employeeBelongingItem.findMany({
                where: {
                    ...(roleSlug ? { roleSlug } : {}),
                    ...(includeInactive ? {} : { isActive: true }),
                },
                orderBy: [{ roleSlug: 'asc' }, { itemName: 'asc' }],
            });

            return successResponse(items, 'Belonging items fetched successfully');
        } catch (error: any) {
            console.error('Error fetching belonging items:', error);
            return errorResponse(error.message || 'Failed to fetch belonging items', 500);
        }
    })(request);
}

// POST /api/hr/belongings/catalog
export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const body = await req.json();
            const data = belongingItemSchema.parse(body);

            const existing = await prisma.employeeBelongingItem.findFirst({
                where: { roleSlug: data.roleSlug, itemName: { equals: data.itemName, mode: 'insensitive' }, isActive: true },
            });
            if (existing) {
                return errorResponse('An active item with this name already exists for the selected role', 409);
            }

            const item = await prisma.employeeBelongingItem.create({ data });
            return successResponse(item, 'Belonging item created successfully', 201);
        } catch (error: any) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            console.error('Error creating belonging item:', error);
            return errorResponse(error.message || 'Failed to create belonging item', 500);
        }
    })(request);
}

// PUT /api/hr/belongings/catalog?id=
export async function PUT(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const { searchParams } = new URL(req.url);
            const id = searchParams.get('id');
            if (!id) return errorResponse('Item ID is required', 400);

            const body = await req.json();
            const data = belongingItemSchema.parse(body);

            const duplicate = await prisma.employeeBelongingItem.findFirst({
                where: { id: { not: id }, roleSlug: data.roleSlug, itemName: { equals: data.itemName, mode: 'insensitive' }, isActive: true },
            });
            if (duplicate) {
                // See departments/route.ts PUT for why this is split on the
                // false->true transition specifically.
                if (data.isActive === true) {
                    const current = await prisma.employeeBelongingItem.findUnique({ where: { id }, select: { isActive: true } });
                    if (current && !current.isActive) {
                        return errorResponse(`${data.itemName} cannot be reactivated — an active record already uses this name/code`, 409);
                    }
                }
                return errorResponse('An active item with this name already exists for the selected role', 409);
            }

            const item = await prisma.employeeBelongingItem.update({ where: { id }, data });
            return successResponse(item, 'Belonging item updated successfully');
        } catch (error: any) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            console.error('Error updating belonging item:', error);
            return errorResponse(error.message || 'Failed to update belonging item', 500);
        }
    })(request);
}

// DELETE /api/hr/belongings/catalog?id=[&permanent=true]
// Default: soft-deactivate (isActive: false).
// ?permanent=true: actually removes the row. Only allowed when zero
// EmployeeIssuedBelonging issuance records reference it (belongingItemId is
// a required FK — deleting while referenced would violate it).
export async function DELETE(request: NextRequest) {
    return withRole(['ADMIN'], async (req) => {
        try {
            const { searchParams } = new URL(req.url);
            const id = searchParams.get('id');
            if (!id) return errorResponse('Item ID is required', 400);

            const permanent = searchParams.get('permanent') === 'true';
            if (permanent) {
                const inUse = await prisma.employeeIssuedBelonging.count({ where: { belongingItemId: id } });
                if (inUse > 0) {
                    return errorResponse(
                        `Cannot permanently delete: ${inUse} issuance record(s) still reference this item.`,
                        409
                    );
                }
                await prisma.employeeBelongingItem.delete({ where: { id } });
                return successResponse(null, 'Belonging item permanently deleted');
            }

            await prisma.employeeBelongingItem.update({ where: { id }, data: { isActive: false } });
            return successResponse(null, 'Belonging item deactivated successfully');
        } catch (error: any) {
            console.error('Error deactivating belonging item:', error);
            return errorResponse(error.message || 'Failed to deactivate belonging item', 500);
        }
    })(request);
}
