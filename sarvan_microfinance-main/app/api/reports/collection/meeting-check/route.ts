import { NextRequest } from 'next/server';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';
import { getMeetingCheckRows } from '@/app/lib/reports/queries/batch3';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/reports/collection/meeting-check
 * Query params: reportDate
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const reportDateStr = searchParams.get('reportDate');
            const branchId = searchParams.get('branchId');
            const centerId = searchParams.get('centerId');

            if (!reportDateStr) {
                return errorResponse('Report date is required', 400);
            }
            if (isNaN(new Date(reportDateStr).getTime())) {
                return errorResponse('Invalid date format', 400);
            }

            // Role-based branch scoping — fails safe: a client-supplied branchId
            // outside the caller's permitted set is ignored, never honored.
            const scopedBranchIds = await resolveScopedBranchIds(user, branchId);
            const result = await getMeetingCheckRows({ reportDate: reportDateStr, branchIds: scopedBranchIds, centerId });

            return successResponse(result, 'Meeting check data fetched successfully');
        } catch (error) {
            console.error('[Meeting Check API] Error:', error);
            return errorResponse('Failed to fetch meeting check data', 500);
        }
    })(request);
}
