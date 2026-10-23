import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    successResponse,
    errorResponse,
    withRole,
} from '@/app/lib/api-utils';
import { getClientTransferData } from '@/app/lib/actions/reports';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/reports/client/transfer
 * Get client transfer history report
 */
export async function GET(request: NextRequest) {
    return withRole(['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER', 'FDO'], async (req, user) => {
        try {
            const searchParams = req.nextUrl.searchParams;
            const fromDate = searchParams.get('fromDate');
            const tillDate = searchParams.get('tillDate');
            const centerId = searchParams.get('centerId') || undefined;
            const branchIdParam = searchParams.get('branchId');

            if (!fromDate || !tillDate) {
                return errorResponse('Missing fromDate or tillDate', 400);
            }

            // Fails safe — a client-supplied branchId outside the caller's permitted
            // set is ignored, never honored (BM/FDO forced to own branch; AREA_MANAGER
            // restricted to their assigned branches)
            const scopedBranchIds = await resolveScopedBranchIds(user, branchIdParam);

            let data;
            if (scopedBranchIds === null) {
                data = await getClientTransferData(fromDate, tillDate, centerId, undefined);
            } else if (scopedBranchIds.length <= 1) {
                data = await getClientTransferData(fromDate, tillDate, centerId, scopedBranchIds[0]);
            } else {
                const perBranch = await Promise.all(
                    scopedBranchIds.map((bId) => getClientTransferData(fromDate, tillDate, centerId, bId))
                );
                data = perBranch.flat();
            }

            return successResponse(data);
        } catch (error) {
            console.error('Client Transfer Report Error:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to fetch report data',
                500
            );
        }
    })(request);
}
