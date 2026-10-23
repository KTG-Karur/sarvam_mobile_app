import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { assertFdoOwnsCenter, checkCenterAccess } from '@/app/lib/filters/fdo-center-scope';
import { isAmAssignedToBranch } from '@/app/lib/am-branch-utils';
import { getBalanceInformationRows } from '@/app/lib/reports/queries/batch1';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/reports/client/balance-information
 * Fetches client loan balances and arrears per center as of a specific date
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const centerId = searchParams.get('centerId');
            const asOnDateStr = searchParams.get('date');

            if (!centerId) {
                return errorResponse('Center ID is required', 400);
            }
            if (!asOnDateStr) {
                return errorResponse('As On Date is required', 400);
            }
            if (isNaN(new Date(asOnDateStr).getTime())) {
                return errorResponse('Invalid date format', 400);
            }

            // Enforce role-based center access
            if (user.role !== 'ADMIN') {
                const centerRecord = await prisma.center.findUnique({
                    where: { id: centerId },
                    select: { branchId: true, fdoId: true },
                });

                if (!centerRecord) {
                    return errorResponse('Center not found', 404);
                }

                if (user.role === 'FDO') {
                    if (!assertFdoOwnsCenter(user, centerRecord)) {
                        return errorResponse('Access denied to this center', 403);
                    }
                } else if (user.role === 'AREA_MANAGER') {
                    const assigned = await isAmAssignedToBranch(user.userId, centerRecord.branchId);
                    if (!assigned) {
                        return errorResponse('Access denied to this center', 403);
                    }
                } else {
                    const accessError = await checkCenterAccess(user, centerRecord);
                    if (accessError) {
                        return errorResponse('Access denied to this center', 403);
                    }
                }
            }

            const reportData = await getBalanceInformationRows({ centerId, asOnDate: asOnDateStr });

            return successResponse(reportData, 'Client balance information retrieved successfully');
        } catch (error) {
            console.error('Error fetching balance information:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to fetch balance information',
                500
            );
        }
    })(request);
}
