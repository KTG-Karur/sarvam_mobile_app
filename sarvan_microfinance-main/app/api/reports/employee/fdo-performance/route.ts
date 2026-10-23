import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';
import { getFdoPerformanceRows } from '@/app/lib/reports/queries/batch4';

export async function OPTIONS() {
    return handleCorsPreflight();
}

export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const fromDateStr = searchParams.get('fromDate');
            const tillDateStr = searchParams.get('tillDate');

            if (!fromDateStr || !tillDateStr) {
                return errorResponse('fromDate and tillDate are required', 400);
            }

            // Filter FDOs by branch context — the caller's actual permitted branch(es),
            // never a blindly-trusted client header (fails safe against override/omission).
            // Explicit ?branchId= (report filter dropdown) takes precedence over the
            // caller's globally-active branch header when both are present.
            const branchIdParam = searchParams.get('branchId') || request.headers.get('X-Branch-Id');
            const scopedBranchIds = await resolveScopedBranchIds(user, branchIdParam);
            const rows = await getFdoPerformanceRows({ fromDate: fromDateStr, toDate: tillDateStr, branchIds: scopedBranchIds });

            return successResponse(rows, 'FDO Performance data fetched successfully');
        } catch (error) {
            console.error('[FDO-Performance] Error:', error);
            return errorResponse('Failed to fetch FDO performance report', 500);
        }
    })(request);
}
