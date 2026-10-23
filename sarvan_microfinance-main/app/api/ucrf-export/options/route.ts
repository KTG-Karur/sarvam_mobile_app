import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import { errorResponse, handleCorsPreflight, successResponse } from '@/app/lib/api-utils';
import { withUcrfAdmin } from '@/app/lib/ucrf/admin-guard';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/** GET /api/ucrf-export/options — branch and loan-product choices for the filter bar (ADMIN only). */
export async function GET(request: NextRequest) {
    return withUcrfAdmin(async () => {
        try {
            const [branches, products] = await Promise.all([
                prisma.branch.findMany({ where: { isActive: true }, orderBy: { name: 'asc' }, select: { id: true, code: true, name: true } }),
                prisma.loanProduct.findMany({ orderBy: { productName: 'asc' }, select: { id: true, productName: true } }),
            ]);
            return successResponse({ branches, products });
        } catch (error) {
            console.error('[ucrf-export] options failed', error instanceof Error ? error.message : error);
            return errorResponse('Failed to load filter options', 500);
        }
    })(request);
}
