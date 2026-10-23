import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';
import { getAdditionDeletionRows } from '@/app/lib/reports/queries/batch1';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/reports/client/addition-deletion
 * Aggregates client statistics (Opening, Induction, Dropped) per center for a date range
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const fromDateStr = searchParams.get('fromDate');
            const tillDateStr = searchParams.get('tillDate');
            const branchId = searchParams.get('branchId') || undefined;
            const centerId = searchParams.get('centerId') || undefined;

            if (!fromDateStr || !tillDateStr) {
                return errorResponse('From date and Till date are required', 400);
            }
            if (isNaN(new Date(fromDateStr).getTime()) || isNaN(new Date(tillDateStr).getTime())) {
                return errorResponse('Invalid date format', 400);
            }

            const scopedBranchIds = await resolveScopedBranchIds(user, branchId);
            const reportData = await getAdditionDeletionRows({
                fromDate: fromDateStr,
                toDate: tillDateStr,
                branchIds: scopedBranchIds,
                centerId,
            });

            return successResponse(reportData, 'Client addition deletion data retrieved successfully');
        } catch (error) {
            console.error('Error fetching client addition deletion:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to fetch client addition deletion',
                500
            );
        }
    })(request);
}
