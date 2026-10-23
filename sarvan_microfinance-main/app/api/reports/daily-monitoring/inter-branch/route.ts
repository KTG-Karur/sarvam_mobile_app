import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import type { JWTPayload } from '@/app/lib/auth';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';

function parseDateOnlyUtc(dateParam: string): Date | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateParam);
    if (!m) return null;

    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));

    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
    ) {
        return null;
    }

    return date;
}

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/reports/daily-monitoring/inter-branch
 * Fetch inter-branch transfers for a specific date
 */
async function handler(req: NextRequest, user: JWTPayload) {
    try {
        const { searchParams } = new URL(req.url);
        const reportDateParam = searchParams.get('date');
        const branchIdParam = searchParams.get('branchId');

        if (!reportDateParam) {
            return errorResponse('Report date is required', 400);
        }

        const reportDate = parseDateOnlyUtc(reportDateParam);
        if (!reportDate) {
            return errorResponse('Invalid date format', 400);
        }

        const startOfDay = new Date(reportDate);
        const endOfDay = new Date(reportDate);
        endOfDay.setUTCHours(23, 59, 59, 999);

        // Fails safe — a client-supplied branchId outside the caller's permitted
        // set is ignored, never honored. Role-agnostic: BRANCH_MANAGER (via
        // UserBranchAssignment), AREA_MANAGER (via AreaManagerBranch), and any
        // other role are all restricted to their assigned branches instead of
        // defaulting to "all branches".
        const branchFilterIds = await resolveScopedBranchIds(user, branchIdParam);
        if (branchFilterIds !== null && branchFilterIds.length === 0) {
            return errorResponse('Branch context missing for this user', 403);
        }

        const transfers = await prisma.branchTransfer.findMany({
            where: {
                transferDate: {
                    gte: startOfDay,
                    lte: endOfDay,
                },
                status: 'COMPLETED',
                ...(branchFilterIds ? {
                    OR: [
                        { fromBranchId: { in: branchFilterIds } },
                        { toBranchId: { in: branchFilterIds } },
                    ],
                } : {}),
            },
            include: {
                fromBranch: {
                    select: {
                        name: true,
                        code: true,
                    }
                },
                toBranch: {
                    select: {
                        name: true,
                        code: true,
                    }
                },
                createdBy: {
                    select: {
                        firstName: true,
                        lastName: true,
                    }
                }
            },
            orderBy: {
                createdAt: 'asc',
            },
        });

        const formattedRows = transfers.map((t, index) => ({
            id: t.id,
            slNo: index + 1,
            date: t.transferDate.toISOString().split('T')[0],
            transferFrom: t.fromBranch.name,
            transferTo: t.toBranch.name,
            amount: Number(t.amount),
            toAmount: Number(t.toAmount),
            narration: t.narration || '',
            createdBy: `${t.createdBy.firstName} ${t.createdBy.lastName}`,
        }));

        return successResponse(formattedRows, 'Inter-branch transfers fetched successfully');
    } catch (error) {
        console.error('[Inter-Branch] Error fetching transfers:', error);
        return errorResponse('Failed to fetch inter-branch transfers', 500);
    }
}

export const GET = withRole(['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'], handler);
