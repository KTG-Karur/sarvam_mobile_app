import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';

export async function OPTIONS() {
    return handleCorsPreflight();
}

export async function GET(request: NextRequest) {
    return withAuth(async (req) => {
        try {
            const { searchParams } = new URL(req.url);
            const branchId = searchParams.get('branchId');
            const centerId = searchParams.get('centerId');

            if (!branchId || !centerId) {
                return errorResponse('branchId and centerId are required', 400);
            }

            const [branchRecord, centerRecord] = await Promise.all([
                prisma.branch.findUnique({ where: { id: branchId }, select: { code: true } }),
                prisma.center.findUnique({ where: { id: centerId }, select: { code: true } }),
            ]);

            const idxPrefix = `${branchRecord?.code ?? '000'}-${centerRecord?.code ?? '000'}-`;
            const existingCount = await prisma.loanIndex.count({ where: { branchId, centerId } });
            const nextId = `${idxPrefix}${(existingCount + 1).toString().padStart(4, '0')}`;

            return successResponse({ nextId }, 'Next index ID generated');
        } catch (error) {
            console.error('Error generating next index ID:', error);
            return errorResponse('Failed to generate next index ID', 500);
        }
    })(request);
}
