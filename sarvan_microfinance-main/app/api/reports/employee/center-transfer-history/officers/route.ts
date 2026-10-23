import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/reports/employee/center-transfer-history/officers
 * FDO dropdown source for the Center Transfer History report's Officer filter —
 * picking an officer here shows their complete transfer timeline, ignoring the
 * date filters (see fdoId handling in getCenterTransferHistoryData).
 */
export async function GET(request: NextRequest) {
    return withRole(['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'], async (req, user) => {
        try {
            const scopedBranchIds = await resolveScopedBranchIds(user, null);

            const officers = await prisma.user.findMany({
                where: {
                    role: 'FDO',
                    ...(scopedBranchIds ? { branchId: { in: scopedBranchIds } } : {}),
                },
                select: { id: true, employeeId: true, firstName: true, lastName: true },
                orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
            });

            return successResponse(
                officers.map((o) => ({ id: o.id, employeeId: o.employeeId, name: `${o.firstName} ${o.lastName}` }))
            );
        } catch (error) {
            return errorResponse(error instanceof Error ? error.message : 'Failed to fetch officers', 500);
        }
    })(request);
}
