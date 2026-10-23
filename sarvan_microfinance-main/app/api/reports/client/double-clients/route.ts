import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';
import { getDoubleClientsRows } from '@/app/lib/reports/queries/batch1';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/reports/client/double-clients
 * Identifies clients with duplicate identification numbers and their current loan status
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const idType = searchParams.get('type') || 'SMART_CARD_NO';
            const branchId = searchParams.get('branchId') || undefined;
            const centerId = searchParams.get('centerId') || undefined;

            const scopedBranchIds = await resolveScopedBranchIds(user, branchId);
            const reportData = await getDoubleClientsRows({ branchIds: scopedBranchIds, centerId, idType });

            return successResponse(reportData, reportData.length === 0 ? 'No double clients found' : 'Double clients report retrieved successfully');
        } catch (error) {
            console.error('Error fetching double clients:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to fetch double clients report',
                500
            );
        }
    })(request);
}
