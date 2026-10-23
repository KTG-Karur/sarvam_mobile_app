import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/disbursements/revert/branches
 * Admin-only: branches this admin is permitted to see, for the Disbursement
 * Revert branch selector. A dedicated endpoint rather than the generic
 * GET /branches (unscoped, shared by unrelated features).
 */
export async function GET(request: NextRequest) {
    return withRole(['ADMIN'], async (_req, user) => {
        try {
            const permitted = await getPermittedBranchIds(user);

            const branches = await prisma.branch.findMany({
                where: {
                    isActive: true,
                    ...(permitted !== null ? { id: { in: permitted } } : {}),
                },
                select: { id: true, name: true, code: true },
                orderBy: { name: 'asc' },
            });

            return successResponse(branches, 'Branches fetched');
        } catch (error: unknown) {
            const message = error instanceof Error ? error.message : 'Failed to fetch branches';
            return errorResponse(message, 500);
        }
    })(request);
}
