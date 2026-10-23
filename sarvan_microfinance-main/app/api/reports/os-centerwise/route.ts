import { NextRequest, NextResponse } from 'next/server';
import { getOSCenterwiseData } from '@/app/lib/actions/reports';
import { withRole } from '@/app/lib/api-utils';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';

/**
 * GET /api/reports/os-centerwise
 * Query params:
 *   - reportDate: string (YYYY-MM-DD format, required)
 *   - branchId: string (optional, filter by branch)
 */
export async function GET(request: NextRequest) {
    return withRole(['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'], async (req, user) => {
        try {
            const searchParams = req.nextUrl.searchParams;
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

            // Fetch OS centerwise data
            const result = await getOSCenterwiseData(reportDate, branchIds ?? undefined);

            return NextResponse.json({
                success: true,
                ...result,
                reportDate,
            });
        } catch (error) {
            console.error('Error fetching OS centerwise data:', error);
            return NextResponse.json(
                {
                    error: 'Failed to fetch OS centerwise data',
                    details: error instanceof Error ? error.message : 'Unknown error',
                },
                { status: 500 }
            );
        }
    })(request);
}
