import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const goldPriceSchema = z.object({
    k24Price: z.number().positive('k24 price must be positive'),
    k22Price: z.number().positive('k22 price must be positive'),
    k20Price: z.number().positive('k20 price must be positive'),
    k18Price: z.number().positive('k18 price must be positive'),
    k16Price: z.number().positive('k16 price must be positive'),
    priceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'priceDate must be YYYY-MM-DD'),
    isActive: z.boolean().optional().default(true),
});

// GET /api/gold-prices — list gold prices for the caller's branch(es)
export async function GET(request: NextRequest) {
    return withRole(['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER', 'FDO'], async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const requestedBranchId = searchParams.get('branchId');
            // Multi-branch aware: an AM (AreaManagerBranch) or any other role
            // assigned multiple branches (UserBranchAssignment) sees gold prices
            // across ALL assigned branches by default; HO-based users see all.
            const scopedBranchIds = await resolveScopedBranchIds(user, requestedBranchId);
            const branchWhere = scopedBranchIds === null
                ? undefined
                : scopedBranchIds.length === 1
                    ? scopedBranchIds[0]
                    : { in: scopedBranchIds };

            const prices = await prisma.goldPrice.findMany({
                where: { branchId: branchWhere },
                orderBy: { priceDate: 'desc' },
                include: {
                    createdBy: { select: { firstName: true, lastName: true } },
                    updatedBy: { select: { firstName: true, lastName: true } },
                },
            });

            return successResponse(prices, 'Gold prices fetched successfully');
        } catch (error) {
            console.error('Error fetching gold prices:', error);
            return errorResponse('Failed to fetch gold prices', 500);
        }
    })(request);
}

// POST /api/gold-prices — create a new gold price entry
export async function POST(request: NextRequest) {
    return withRole(['ADMIN', 'BRANCH_MANAGER'], async (req, user) => {
        try {
            const body = await req.json();
            const data = goldPriceSchema.parse(body);

            const branchId = user.branchId;
            if (!branchId) return errorResponse('Branch context is required', 400);

            const priceDateUTC = new Date(data.priceDate + 'T00:00:00.000Z');

            // Deactivate any existing active price for this branch on the same date
            await prisma.goldPrice.updateMany({
                where: { branchId, priceDate: priceDateUTC, isActive: true },
                data: { isActive: false },
            });

            const price = await prisma.goldPrice.create({
                data: {
                    branchId,
                    k24Price: data.k24Price,
                    k22Price: data.k22Price,
                    k20Price: data.k20Price,
                    k18Price: data.k18Price,
                    k16Price: data.k16Price,
                    priceDate: priceDateUTC,
                    isActive: data.isActive ?? true,
                    createdById: user.userId,
                },
                include: {
                    createdBy: { select: { firstName: true, lastName: true } },
                },
            });

            return successResponse(price, 'Gold price created successfully', 201);
        } catch (error: any) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            console.error('Error creating gold price:', error);
            return errorResponse(error.message || 'Failed to create gold price', 500);
        }
    })(request);
}
