import { NextRequest } from 'next/server';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withAuth,
} from '@/app/lib/api-utils';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';
import { getAttendanceDetailedRows } from '@/app/lib/reports/queries/batch1';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/reports/employee/attendance-detailed
 * Fetches detailed attendance records for employees within a date range.
 * - Branch Managers / FDOs: see only their own branch.
 * - Admin / Area Managers: see all branches (or filtered by optional branchId param).
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

            // reqBranchId is never trusted directly — it's only honored if it falls within
            // the caller's actual permitted branch(es) (resolveScopedBranchIds fails safe).
            // Explicit ?branchId= (report filter dropdown) takes precedence over the
            // caller's globally-active branch header when both are present.
            // An explicit branchId — including 'all' — always wins; the active-branch header is only
            // the fallback when the caller sent no branch filter at all. Without this, picking
            // "All Branches" (param omitted) silently reported just the active branch.
            const reqBranchId = searchParams.has('branchId') ? searchParams.get('branchId') : req.headers.get('x-branch-id');
            const scopedBranchIds = await resolveScopedBranchIds(user, reqBranchId);

            const formattedData = await getAttendanceDetailedRows({
                fromDate: fromDateParam,
                toDate: tillDateParam,
                branchIds: scopedBranchIds,
            });

            return successResponse(formattedData, 'Attendance records retrieved successfully');
        } catch (error) {
            console.error('[Attendance Detailed Report] Error:', error);
            return errorResponse(
                error instanceof Error ? error.message : 'Failed to fetch attendance report',
                500
            );
        }
    })(request);
}
