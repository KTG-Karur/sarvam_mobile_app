import { NextRequest } from 'next/server';
import { prisma } from '@/app/lib/prisma';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/reports/mis-agewise-arrear/officers
 * FDO dropdown source for the Arrear Report filters. Mirrors
 * /api/reports/employee/incentive-report/officers but with this report's own role set.
 * @access ADMIN, ADMIN_NON_HO_BRANCH_SWITCH, BRANCH_MANAGER, AREA_MANAGER
 */
export async function GET(request: NextRequest) {
    return withRole(['ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH', 'BRANCH_MANAGER', 'AREA_MANAGER'], async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const branchIdHeader = req.headers.get('X-Branch-Id');
            const branchId = searchParams.get('branchId') || branchIdHeader;
            const scopedBranchIds = await resolveScopedBranchIds(user, branchId);

            const officers = await prisma.user.findMany({
                where: {
                    role: 'FDO',
                    isActive: true,
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
