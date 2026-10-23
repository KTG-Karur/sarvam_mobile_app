import { NextRequest, NextResponse } from 'next/server';
import { getClientwiseDCBData } from '@/app/lib/actions/reports';
import { withRole } from '@/app/lib/api-utils';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';

/**
 * GET /api/reports/clientwise-dcb
 * Query params:
 *   - fromDate: string (YYYY-MM-DD format)
 *   - toDate: string (YYYY-MM-DD format)
 *   - centerId: string (optional, defaults to 'all')
 *   - branchId: string (optional)
 */
export async function GET(req: NextRequest) {
    return withRole(['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'], async (request, user) => {
    try {
        const searchParams = request.nextUrl.searchParams;
        const fromDate = searchParams.get('fromDate');
        const toDate = searchParams.get('toDate');
        const centerId = searchParams.get('centerId') || 'all';
        const branchIdParam = searchParams.get('branchId');

        // Validate dates
        if (!fromDate || !toDate) {
            return NextResponse.json(
                { error: 'fromDate and toDate are required' },
                { status: 400 }
            );
        }

        // Validate date format
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(fromDate) || !dateRegex.test(toDate)) {
            return NextResponse.json(
                { error: 'Dates must be in YYYY-MM-DD format' },
                { status: 400 }
            );
        }

        // Validate date range
        if (new Date(fromDate) > new Date(toDate)) {
            return NextResponse.json(
                { error: 'fromDate must be before or equal to toDate' },
                { status: 400 }
            );
        }

        // Fetch clientwise DCB data
        const branchIds = await resolveScopedBranchIds(user, branchIdParam);
        const data = await getClientwiseDCBData(fromDate, toDate, centerId, branchIds ?? undefined);

        return NextResponse.json({
            success: true,
            data,
            count: data.length,
            fromDate,
            toDate,
            centerId,
        });
    } catch (error) {
        console.error('Error fetching clientwise DCB data:', error);
        return NextResponse.json(
            {
                error: 'Failed to fetch clientwise DCB data',
                details: error instanceof Error ? error.message : 'Unknown error',
            },
            { status: 500 }
        );
    }
    })(req);
}
