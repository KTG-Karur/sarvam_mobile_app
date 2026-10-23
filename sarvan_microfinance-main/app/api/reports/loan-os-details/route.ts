import { NextRequest, NextResponse } from 'next/server';
import { getLoanOSDetailsData } from '@/app/lib/actions/reports';
import { withRole } from '@/app/lib/api-utils';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function GET(req: NextRequest) {
    return withRole(['ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH', 'BRANCH_MANAGER', 'AREA_MANAGER'], async (request, user) => {
    try {
        const searchParams = request.nextUrl.searchParams;
        const reportDate = searchParams.get('reportDate');
        const branchIdParam = searchParams.get('branchId');
        const centerIdParam = searchParams.get('centerId') || undefined;

        if (!reportDate) {
            return NextResponse.json(
                { error: 'reportDate is required' },
                { status: 400 }
            );
        }

        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(reportDate)) {
            return NextResponse.json(
                { error: 'reportDate must be in YYYY-MM-DD format' },
                { status: 400 }
            );
        }

        const branchIds = await resolveScopedBranchIds(user, branchIdParam);
        const data = await getLoanOSDetailsData(reportDate, branchIds ?? undefined, centerIdParam);

        return NextResponse.json({
            success: true,
            data,
            count: data.length,
            reportDate,
        });
    } catch (error) {
        console.error('Error fetching loan OS details:', error);
        return NextResponse.json(
            {
                error: 'Failed to fetch loan OS details',
                details: error instanceof Error ? error.message : 'Unknown error',
            },
            { status: 500 }
        );
    }
    })(req);
}
