import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { withRole, successResponse, errorResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/** Branches the caller may report on — the server, not the client, decides the dropdown. */
export async function GET(req: NextRequest) {
    return withRole(['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'], async (_request, user) => {
        try {
            const permitted = await getPermittedBranchIds(user);
            const branches = await prisma.branch.findMany({
                where: { isActive: true, ...(permitted === null ? {} : { id: { in: permitted } }) },
                select: { id: true, code: true, name: true },
                orderBy: { name: 'asc' },
            });
            return successResponse({ branches, allowAll: permitted === null || branches.length > 1 });
        } catch (error) {
            console.error('Balance Sheet branches error:', error);
            return errorResponse('Failed to load branches', 500);
        }
    })(req);
}
