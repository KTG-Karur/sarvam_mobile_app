import { NextRequest, NextResponse } from 'next/server';
import { getMISBranchDemandData } from '@/app/lib/actions/reports';
import { withRole } from '@/app/lib/api-utils';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';

/**
 * GET /api/reports/mis-branch-demand
 * Query params:
 *   - fromDate: string (YYYY-MM-DD, required)
 *   - tillDate: string (YYYY-MM-DD, required)
 *   - branchId: string (optional)
 */
export async function GET(req: NextRequest) {
    return withRole(['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'], async (request, user) => {
    try {
        const searchParams = request.nextUrl.searchParams;
        const fromDate = searchParams.get('fromDate');
        const tillDate = searchParams.get('tillDate');
        const branchIdParam = searchParams.get('branchId');

        if (!fromDate || !tillDate) {
            return NextResponse.json(
                { error: 'Both fromDate and tillDate are required' },
                { status: 400 }
            );
        }

        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(fromDate) || !dateRegex.test(tillDate)) {
            return NextResponse.json(
                { error: 'Dates must be in YYYY-MM-DD format' },
                { status: 400 }
            );
        }

        if (new Date(fromDate) > new Date(tillDate)) {
            return NextResponse.json(
                { error: 'fromDate cannot be after tillDate' },
                { status: 400 }
            );
        }

        // Guard against excessively large ranges (max 90 days)
        const diffDays = Math.ceil(
            (new Date(tillDate).getTime() - new Date(fromDate).getTime()) / (1000 * 60 * 60 * 24)
        );
        if (diffDays > 90) {
            return NextResponse.json(
                { error: 'Date range cannot exceed 90 days' },
                { status: 400 }
            );
        }

        const branchIds = await resolveScopedBranchIds(user, branchIdParam);
        const result = await getMISBranchDemandData(fromDate, tillDate, branchIds ?? undefined);

        return NextResponse.json({
            success: true,
            ...result,
            fromDate,
            tillDate,
        });
    } catch (error) {
        console.error('Error fetching MIS branch demand data:', error);
        return NextResponse.json(
            {
                error: 'Failed to fetch MIS branch demand data',
                details: error instanceof Error ? error.message : 'Unknown error',
            },
            { status: 500 }
        );
    }
    })(req);
}
