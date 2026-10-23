import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    successResponse,
    errorResponse,
    withRole,
} from '@/app/lib/api-utils';
import { getCenterTransferHistoryData } from '@/app/lib/actions/reports';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/reports/employee/center-transfer-history
 * Get center-to-FDO transfer history report (CenterTransfer events only).
 * reportType=RANGE requires fromDate & tillDate; reportType=AS_ON requires asOnDate.
 * fdoId, when present, overrides all of the above — it returns that officer's
 * complete transfer timeline regardless of date/reportType.
 */
export async function GET(request: NextRequest) {
    return withRole(['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'], async (req, user) => {
        try {
            const searchParams = req.nextUrl.searchParams;
            const reportType = searchParams.get('reportType') === 'AS_ON' ? 'AS_ON' as const : 'RANGE' as const;
            const fromDate = searchParams.get('fromDate');
            const tillDate = searchParams.get('tillDate');
            const asOnDate = searchParams.get('asOnDate');
            const branchIdParam = searchParams.get('branchId');
            const centerId = searchParams.get('centerId') || undefined;
            const fdoId = searchParams.get('fdoId') || undefined;

            if (!fdoId) {
                if (reportType === 'RANGE' && (!fromDate || !tillDate)) {
                    return errorResponse('Missing fromDate or tillDate', 400);
                }
                if (reportType === 'AS_ON' && !asOnDate) {
                    return errorResponse('Missing asOnDate', 400);
                }
            }

            // Fails safe — a client-supplied branchId/centerId/fdoId outside the caller's
            // permitted set is ignored, never honored (BM forced to own branch;
            // AREA_MANAGER restricted to their assigned branches).
            const scopedBranchIds = await resolveScopedBranchIds(user, branchIdParam);

            const data = await getCenterTransferHistoryData({
                mode: reportType,
                fromDate: fromDate || undefined,
                tillDate: tillDate || undefined,
                asOnDate: asOnDate || undefined,
                branchIds: scopedBranchIds,
                centerId,
                fdoId,
            });

            return successResponse(data);
        } catch (error) {
            console.error('Center Transfer History Report Error:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to fetch report data',
                500
            );
        }
    })(request);
}
