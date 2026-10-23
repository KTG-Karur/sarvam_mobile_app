import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { getClientAdditionDisbursedData } from '@/app/lib/actions/reports';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/reports/client/addition-disbursed
 * Fetches client addition and disbursement records for a given date range and center.
 */
export async function GET(request: NextRequest) {
    return withRole(['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'FDO'], async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const fromDate = searchParams.get('fromDate');
            const tillDate = searchParams.get('tillDate');
            const centerId = searchParams.get('centerId') || undefined;
            const branchIdFilter = searchParams.get('branchId');

            if (!fromDate || !tillDate) {
                return errorResponse('fromDate and tillDate are required', 400);
            }

            // Determine branch restriction based on role (fails safe — a client-supplied
            // branchId outside the caller's permitted set is ignored, never honored)
            const scopedBranchIds = await resolveScopedBranchIds(user, branchIdFilter);

            let data;
            if (scopedBranchIds === null) {
                data = await getClientAdditionDisbursedData(fromDate, tillDate, centerId, undefined);
            } else if (scopedBranchIds.length <= 1) {
                data = await getClientAdditionDisbursedData(fromDate, tillDate, centerId, scopedBranchIds[0]);
            } else {
                const perBranch = await Promise.all(
                    scopedBranchIds.map((bId) => getClientAdditionDisbursedData(fromDate, tillDate, centerId, bId))
                );
                data = perBranch.flat();
            }

            return successResponse(data, 'Client addition and disbursement report fetched successfully');
        } catch (error) {
            console.error('[AdditionDisbursedReport] Error fetching data:', error);
            return errorResponse('Failed to fetch report data', 500);
        }
    })(request);
}
