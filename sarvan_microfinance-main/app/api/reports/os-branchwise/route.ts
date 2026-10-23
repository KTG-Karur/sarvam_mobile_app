import { NextRequest, NextResponse } from 'next/server';
import { getOSBranchwiseData } from '@/app/lib/actions/reports';
import { withRole } from '@/app/lib/api-utils';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';

/**
 * GET /api/reports/os-branchwise
 * Query params:
 *   - reportDate: string (YYYY-MM-DD format)
 *   - branchId: string (optional)
 */
export async function GET(req: NextRequest) {
    return withRole(['ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH', 'BRANCH_MANAGER', 'AREA_MANAGER'], async (request, user) => {
    try {
        const searchParams = request.nextUrl.searchParams;
        const reportDate = searchParams.get('reportDate');
        const branchIdParam = searchParams.get('branchId');

        // Validate reportDate
        if (!reportDate) {
            return NextResponse.json(
                { error: 'reportDate is required' },
                { status: 400 }
            );
        }

        // Validate date format
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(reportDate)) {
            return NextResponse.json(
                { error: 'reportDate must be in YYYY-MM-DD format' },
                { status: 400 }
            );
        }

        const branchIds = await resolveScopedBranchIds(user, branchIdParam);

        // Fetch OS branchwise data (unrestricted admin gets branchIds === null → all branches)
        const data = await getOSBranchwiseData(reportDate, branchIds ?? undefined);

        return NextResponse.json({
            success: true,
            data,
            count: data.length,
            reportDate,
        });
    } catch (error) {
        console.error('Error fetching OS branchwise data:', error);
        return NextResponse.json(
            {
                error: 'Failed to fetch OS branchwise data',
                details: error instanceof Error ? error.message : 'Unknown error',
            },
            { status: 500 }
        );
    }
    })(req);
}
