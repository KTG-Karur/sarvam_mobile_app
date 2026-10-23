import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/db';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { generateNextCenterCode } from '@/app/lib/services/center-code.service';

export async function OPTIONS() {
    return handleCorsPreflight();
}

export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            // BM/FDO always get their own branch's suggestion, regardless of any
            // client-supplied branchId. Only ADMIN may request a specific branch.
            const requestedBranchId = req.nextUrl.searchParams.get('branchId');
            let branchId: string | null =
                user.role === 'ADMIN' ? requestedBranchId : (user.branchId ?? null);

            if (!branchId) {
                const userRecord = await prisma.user.findUnique({
                    where: { id: user.userId },
                    select: { branchId: true },
                });
                branchId = userRecord?.branchId ?? null;
            }

            if (!branchId) {
                return errorResponse('branchId is required', 400);
            }

            const nextId = await generateNextCenterCode(branchId);
            return successResponse({ nextId }, 'Next center ID generated');
        } catch (error) {
            console.error('Error generating next center ID:', error);
            return errorResponse('Failed to generate next center ID', 500);
        }
    })(request);
}
