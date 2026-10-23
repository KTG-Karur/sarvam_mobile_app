import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';
import { getWaitingBorrowersDetailedRows, getWaitingBorrowersSummaryRows } from '@/app/lib/reports/queries/batch3';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/reports/client/waiting-borrowers
 * Fetches detailed or summary report of waiting borrowers with aging analysis
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const type = searchParams.get('type') || 'DETAILED';
            const branchId = searchParams.get('branchId') || undefined;
            const centerId = searchParams.get('centerId') || undefined;
            const scopedBranchIds = await resolveScopedBranchIds(user, branchId);

            const data = type === 'SUMMARY'
                ? await getWaitingBorrowersSummaryRows({ branchIds: scopedBranchIds, centerId })
                : await getWaitingBorrowersDetailedRows({ branchIds: scopedBranchIds, centerId });

            return successResponse(data, `${type === 'SUMMARY' ? 'Summary' : 'Detailed'} waiting borrowers report retrieved`);
        } catch (error) {
            console.error('Error fetching waiting borrowers:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to fetch waiting borrowers report',
                500
            );
        }
    })(request);
}
