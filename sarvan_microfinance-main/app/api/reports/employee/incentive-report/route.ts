import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';
import { getIncentiveReportData } from '@/app/lib/services/incentive-report.service';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const querySchema = z.object({
    fromDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'fromDate must be YYYY-MM-DD'),
    toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'toDate must be YYYY-MM-DD'),
    divisionId: z.string().optional(),
    branchId: z.string().optional(),
    fdoId: z.string().optional(),
    search: z.string().optional(),
    sortBy: z.string().optional(),
    sortOrder: z.enum(['asc', 'desc']).optional(),
    page: z.coerce.number().int().min(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(200).optional(),
    exportAll: z.coerce.boolean().optional(),
});

/**
 * GET /api/reports/employee/incentive-report
 * Month-wise FDO incentive report — filters: date range, division, branch, field officer.
 * @access ADMIN, DIVISION_MANAGER, AREA_MANAGER, BRANCH_MANAGER
 */
export async function GET(request: NextRequest) {
    return withRole(['ADMIN', 'AREA_MANAGER', 'BRANCH_MANAGER'], async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const parsed = querySchema.safeParse(Object.fromEntries(searchParams.entries()));
            if (!parsed.success) {
                return errorResponse(parsed.error.errors[0].message, 400);
            }
            const query = parsed.data;

            const branchIdHeader = req.headers.get('X-Branch-Id');
            const scopedBranchIds = await resolveScopedBranchIds(user, query.branchId || branchIdHeader);

            const result = await getIncentiveReportData({
                fromDate: query.fromDate,
                toDate: query.toDate,
                scopedBranchIds,
                branchId: query.branchId,
                divisionId: query.divisionId,
                fdoId: query.fdoId,
                search: query.search,
                sortBy: query.sortBy,
                sortOrder: query.sortOrder,
                page: query.page,
                pageSize: query.pageSize,
                exportAll: query.exportAll,
            });

            return successResponse(result, 'Incentive report fetched successfully');
        } catch (error) {
            return errorResponse(error instanceof Error ? error.message : 'Failed to fetch incentive report', 500);
        }
    })(request);
}
