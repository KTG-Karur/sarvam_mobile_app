import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, successResponse, withAuth, handleCorsPreflight } from '@/app/lib/api-utils';
import { z } from 'zod';

const permissionTypeSchema = z.object({
    permissionType: z.string().min(1, 'Permission Type name is required').optional(),
    isActive: z.boolean().optional(),
});

export async function OPTIONS() {
    return handleCorsPreflight();
}

// Helper to safely get the PermissionType model
function getPermissionTypeModel() {
    const model = (prisma as any).permissionType;
    if (!model) {
        console.error('PermissionType model is MISSING from prisma client. This usually requires a server restart after schema changes.');
        throw new Error('Database client sync error. Please restart the server.');
    }
    return model;
}

export async function GET(request: NextRequest) {
    return withAuth(async (req) => {
        try {
            const { searchParams } = new URL(req.url);
            const includeInactive = searchParams.get('includeInactive') === 'true' || searchParams.get('all') === 'true';
            const model = getPermissionTypeModel();
            const whereClause = includeInactive ? {} : { isActive: true };
            const permissionTypes = await model.findMany({
                where: whereClause,
                orderBy: { typeId: 'asc' },
            });
            return successResponse(permissionTypes, 'Permission types fetched successfully');
        } catch (error: any) {
            console.error('Error fetching permission types:', error);
            return errorResponse(error.message || 'Failed to fetch permission types', 500);
        }
    })(request);
}

export async function POST(request: NextRequest) {
    return withAuth(async (req) => {
        try {
            const model = getPermissionTypeModel();
            const body = await req.json();
            const validation = permissionTypeSchema.safeParse(body);
            if (!validation.success) {
                return errorResponse(validation.error.errors[0].message, 400);
            }

            const { permissionType, isActive } = validation.data;
            if (!permissionType) {
                return errorResponse('Permission Type name is required', 400);
            }

            // Check if already exists
            const existing = await model.findFirst({
                where: { permissionType: { equals: permissionType, mode: 'insensitive' } },
            });

            if (existing) {
                return errorResponse('Permission Type already exists', 400);
            }

            // Get next typeId
            const lastType = await model.findFirst({
                orderBy: { typeId: 'desc' },
            });
            const nextTypeId = (lastType?.typeId || 0) + 1;

            const newPermissionType = await model.create({
                data: {
                    typeId: nextTypeId,
                    permissionType: permissionType.toUpperCase(),
                    isActive: isActive !== undefined ? isActive : true,
                },
            });

            return successResponse(newPermissionType, 'Permission type created successfully', 201);
        } catch (error: any) {
            console.error('Error creating permission type:', error);
            return errorResponse(error.message || 'Failed to create permission type', 500);
        }
    })(request);
}

export async function PUT(request: NextRequest) {
    return withAuth(async (req) => {
        try {
            const model = getPermissionTypeModel();
            const { searchParams } = new URL(req.url);
            const id = searchParams.get('id');
            if (!id) return errorResponse('ID is required', 400);

            const body = await req.json();
            const validation = permissionTypeSchema.safeParse(body);
            if (!validation.success) {
                return errorResponse(validation.error.errors[0].message, 400);
            }

            const { permissionType, isActive } = validation.data;

            if (permissionType) {
                const existing = await model.findFirst({
                    where: {
                        permissionType: { equals: permissionType, mode: 'insensitive' },
                        NOT: { id },
                    },
                });
                if (existing) {
                    return errorResponse('Permission Type already exists', 400);
                }
            }

            const updateData: any = {};
            if (permissionType !== undefined) updateData.permissionType = permissionType.toUpperCase();
            if (isActive !== undefined) updateData.isActive = isActive;

            const updatedPermissionType = await model.update({
                where: { id },
                data: updateData,
            });

            return successResponse(updatedPermissionType, 'Permission type updated successfully');
        } catch (error: any) {
            console.error('Error updating permission type:', error);
            return errorResponse(error.message || 'Failed to update permission type', 500);
        }
    })(request);
}

export async function DELETE(request: NextRequest) {
    return withAuth(async (req) => {
        try {
            const model = getPermissionTypeModel();
            const { searchParams } = new URL(req.url);
            const id = searchParams.get('id');
            if (!id) return errorResponse('ID is required', 400);

            // Soft delete
            await model.update({
                where: { id },
                data: { isActive: false },
            });

            return successResponse(null, 'Permission type deleted successfully');
        } catch (error: any) {
            console.error('Error deleting permission type:', error);
            return errorResponse(error.message || 'Failed to delete permission type', 500);
        }
    })(request);
}
