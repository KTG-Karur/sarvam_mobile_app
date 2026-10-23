import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';
import { getAttendanceSummaryRows } from '@/app/lib/reports/queries/batch1';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/reports/employee/attendance-summary
 * Aggregates attendance data per employee for a given date range.
 * Returns counts of PRESENT, ABSENT, HALF_DAY, FULL_DAY per employee.
 *
 * - Branch Managers / FDOs: see only their own branch.
 * - Admin / Area Managers: see all branches.
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const fromDateParam = searchParams.get('fromDate');
            const tillDateParam = searchParams.get('tillDate');

            if (!fromDateParam || !tillDateParam) {
                return errorResponse('fromDate and tillDate are required', 400);
            }

            // Role-based branch isolation. reqBranchId is never trusted directly — it's only
            // honored if it falls within the caller's actual permitted branch(es); org-level
            // roles with no header default to their real permitted set (not "all branches").
            // Explicit ?branchId= (report filter dropdown) takes precedence over the
            // caller's globally-active branch header when both are present.
            // An explicit branchId — including 'all' — always wins; the active-branch header is only
            // the fallback when the caller sent no branch filter at all. Without this, picking
            // "All Branches" (param omitted) silently reported just the active branch.
            const reqBranchId = searchParams.has('branchId') ? searchParams.get('branchId') : req.headers.get('x-branch-id');
            const scopedBranchIds = await resolveScopedBranchIds(user, reqBranchId);

            const result = await getAttendanceSummaryRows({
                fromDate: fromDateParam,
                toDate: tillDateParam,
                branchIds: scopedBranchIds,
            });

            return successResponse(result, 'Attendance summary generated successfully');
        } catch (error) {
            console.error('[Attendance Summary Report] Error:', error);
            return errorResponse(
                error instanceof Error
                    ? error.message
                    : 'Failed to generate attendance summary',
                500
            );
        }
    })(request);
}
