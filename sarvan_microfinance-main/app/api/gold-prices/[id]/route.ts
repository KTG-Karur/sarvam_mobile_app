import { NextRequest } from 'next/server';
import { z } from 'zod';
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

const updateSchema = z.object({
    k24Price: z.number().positive().optional(),
    k22Price: z.number().positive().optional(),
    k20Price: z.number().positive().optional(),
    k18Price: z.number().positive().optional(),
    k16Price: z.number().positive().optional(),
    priceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    isActive: z.boolean().optional(),
});

// GET /api/gold-prices/[id] — fetch a single gold price record
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    return withRole(['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER', 'FDO'], async () => {
        try {
            const { id } = await params;

            const price = await prisma.goldPrice.findUnique({
                where: { id },
                include: {
                    createdBy: { select: { firstName: true, lastName: true } },
                    updatedBy: { select: { firstName: true, lastName: true } },
                },
            });

            if (!price) return errorResponse('Gold price record not found', 404);

            return successResponse(price, 'Gold price fetched successfully');
        } catch (error) {
            console.error('Error fetching gold price:', error);
            return errorResponse('Failed to fetch gold price', 500);
        }
    })(request);
}

// PUT /api/gold-prices/[id] — update a gold price record
export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    return withRole(['ADMIN', 'BRANCH_MANAGER'], async (req, user) => {
        try {
            const { id } = await params;
            const body = await req.json();
            const { k24Price, k22Price, k20Price, k18Price, k16Price, isActive, priceDate, ...rest } =
                updateSchema.parse(body);

            const existing = await prisma.goldPrice.findUnique({ where: { id } });
            if (!existing) return errorResponse('Gold price record not found', 404);

            const updateData: Record<string, unknown> = { updatedById: user.userId };

            if (k24Price !== undefined) updateData.k24Price = k24Price;
            if (k22Price !== undefined) updateData.k22Price = k22Price;
            if (k20Price !== undefined) updateData.k20Price = k20Price;
            if (k18Price !== undefined) updateData.k18Price = k18Price;
            if (k16Price !== undefined) updateData.k16Price = k16Price;
            if (isActive !== undefined) updateData.isActive = isActive;
            if (priceDate !== undefined) updateData.priceDate = new Date(priceDate + 'T00:00:00.000Z');

            void rest; // unused remainder — schema is exhaustive

            const updated = await prisma.goldPrice.update({
                where: { id },
                data: updateData,
                include: {
                    createdBy: { select: { firstName: true, lastName: true } },
                    updatedBy: { select: { firstName: true, lastName: true } },
                },
            });

            return successResponse(updated, 'Gold price updated successfully');
        } catch (error: any) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            console.error('Error updating gold price:', error);
            return errorResponse(error.message || 'Failed to update gold price', 500);
        }
    })(request);
}

// DELETE /api/gold-prices/[id] — remove a gold price record
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    return withRole(['ADMIN', 'BRANCH_MANAGER'], async () => {
        try {
            const { id } = await params;

            const existing = await prisma.goldPrice.findUnique({ where: { id } });
            if (!existing) return errorResponse('Gold price record not found', 404);

            await prisma.goldPrice.delete({ where: { id } });

            return successResponse(null, 'Gold price deleted successfully');
        } catch (error) {
            console.error('Error deleting gold price:', error);
            return errorResponse('Failed to delete gold price', 500);
        }
    })(request);
}
