import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';
import { getCenterMasterRows } from '@/app/lib/reports/queries/batch3';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/reports/others/center-master
 * Fetch center master statistics and details as of a specific date
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const reportDateStr = searchParams.get('date');
            const branchId = searchParams.get('branchId') || undefined;

            if (!reportDateStr) {
                return errorResponse('Report date is required', 400);
            }

            if (isNaN(new Date(reportDateStr).getTime())) {
                return errorResponse('Invalid date format', 400);
            }

            // Fetch centers with necessary relations, scoped to the caller's permitted branch(es)
            const scopedBranchIds = await resolveScopedBranchIds(user, branchId ?? null);
            const reportData = await getCenterMasterRows({
                reportDate: reportDateStr,
                branchIds: scopedBranchIds,
            });

            return successResponse(reportData, 'Center master data retrieved successfully');
        } catch (error) {
            console.error('Error fetching center master:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to fetch center master',
                500
            );
        }
    })(request);
}
