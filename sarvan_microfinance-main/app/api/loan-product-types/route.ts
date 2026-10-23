// app/api/loan-product-types/route.ts
import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';

export async function OPTIONS() {
    return handleCorsPreflight();
}

// GET /api/loan-product-types - List all product types
export async function GET(request: NextRequest) {
    return withRole(['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER', 'FDO'], async () => {
        try {
            const { searchParams } = new URL(request.url);
            const id = searchParams.get('id');
            const includeInactive = searchParams.get('includeInactive') === 'true';
            const includeCount = searchParams.get('includeCount') === 'true';

            if (id) {
                // Fetch single product type
                const productType = await prisma.loanProductType.findUnique({
                    where: { id },
                    include: {
                        loanProducts: {
                            where: { isActive: true },
                            select: { productId: true, productName: true },
                        },
                    },
                });

                if (!productType) {
                    return errorResponse('Product type not found', 404);
                }

                return successResponse(productType, 'Product type fetched successfully');
            }

            // Fetch all product types
            const productTypes = await prisma.loanProductType.findMany({
                where: includeInactive ? {} : { isActive: true },
                orderBy: { createdAt: 'desc' },
                include: includeCount ? {
                    _count: {
                        select: { loanProducts: { where: { isActive: true } } }
                    }
                } : undefined,
            });

            return successResponse(productTypes, 'Product types fetched successfully');
        } catch (error) {
            console.error('Error fetching product types:', error);
            return errorResponse('Failed to fetch product types', 500);
        }
    })(request);
}

// POST /api/loan-product-types - Create a new product type
export async function POST(request: NextRequest) {
    return withRole(['ADMIN'], async () => {
        try {
            const body = await request.json();

            if (!body.name?.trim()) {
                return errorResponse('Type name is required', 400);
            }

            const normalizedName = body.name.trim();

            // Check for duplicate name (case-insensitive)
            const existingType = await prisma.loanProductType.findFirst({
                where: {
                    name: {
                        equals: normalizedName,
                        mode: 'insensitive',
                    },
                    isActive: true,
                },
            });

            if (existingType) {
                return errorResponse('Product type name already exists', 409);
            }

            // Generate unique typeId
            const existingTypes = await prisma.loanProductType.findMany({
                select: { typeId: true },
                orderBy: { createdAt: 'desc' },
            });

            let nextNumber = 1;
            if (existingTypes.length > 0) {
                const numbers = existingTypes
                    .map((t) => {
                        const match = t.typeId.match(/TYPE-(\d+)/);
                        return match ? parseInt(match[1], 10) : 0;
                    })
                    .filter((n) => n > 0);
                if (numbers.length > 0) {
                    nextNumber = Math.max(...numbers) + 1;
                }
            }
            const typeId = `TYPE-${String(nextNumber).padStart(4, '0')}`;

            const productType = await prisma.loanProductType.create({
                data: {
                    typeId,
                    name: normalizedName,
                    isActive: true,
                },
            });

            return successResponse(productType, 'Product type created successfully', 201);
        } catch (error) {
            console.error('Error creating product type:', error);
            return errorResponse('Failed to create product type', 500);
        }
    })(request);
}

// PUT /api/loan-product-types - Update a product type
export async function PUT(request: NextRequest) {
    return withRole(['ADMIN'], async () => {
        try {
            const body = await request.json();

            if (!body.id) {
                return errorResponse('Product type ID is required', 400);
            }

            if (!body.name?.trim()) {
                return errorResponse('Type name is required', 400);
            }

            const existingType = await prisma.loanProductType.findUnique({
                where: { id: body.id },
            });

            if (!existingType) {
                return errorResponse('Product type not found', 404);
            }

            const normalizedName = body.name.trim();

            // Check for duplicate name (excluding current type)
            const duplicateType = await prisma.loanProductType.findFirst({
                where: {
                    name: {
                        equals: normalizedName,
                        mode: 'insensitive',
                    },
                    id: { not: body.id },
                    isActive: true,
                },
            });

            if (duplicateType) {
                return errorResponse('Product type name already exists', 409);
            }

            const updatedType = await prisma.loanProductType.update({
                where: { id: body.id },
                data: { name: normalizedName },
            });

            return successResponse(updatedType, 'Product type updated successfully');
        } catch (error) {
            console.error('Error updating product type:', error);
            return errorResponse('Failed to update product type', 500);
        }
    })(request);
}

// DELETE /api/loan-product-types - Soft delete a product type
export async function DELETE(request: NextRequest) {
    return withRole(['ADMIN'], async () => {
        try {
            const { searchParams } = new URL(request.url);
            const id = searchParams.get('id');

            if (!id) {
                return errorResponse('Product type ID is required', 400);
            }

            const existingType = await prisma.loanProductType.findUnique({
                where: { id },
                include: {
                    loanProducts: {
                        where: { isActive: true },
                        select: { id: true },
                        take: 1,
                    },
                },
            });

            if (!existingType) {
                return errorResponse('Product type not found', 404);
            }

            // Check if any active loan products use this type
            if (existingType.loanProducts.length > 0) {
                return errorResponse(
                    'Cannot delete product type that has active loan products. Please reassign products first.',
                    400
                );
            }

            // Soft delete
            await prisma.loanProductType.update({
                where: { id },
                data: { isActive: false },
            });

            return successResponse(null, 'Product type deleted successfully');
        } catch (error) {
            console.error('Error deleting product type:', error);
            return errorResponse('Failed to delete product type', 500);
        }
    })(request);
}