import { NextRequest, NextResponse } from 'next/server';
import { withRole } from '@/app/lib/api-utils';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';
import { getPreclosureRows } from '@/app/lib/reports/queries/batch2';

export async function GET(req: NextRequest) {
    return withRole(['ADMIN', 'ADMIN_NON_HO_BRANCH_SWITCH', 'BRANCH_MANAGER', 'AREA_MANAGER'], async (request, user) => {
    try {
        const searchParams = request.nextUrl.searchParams;
        const fromDateStr = searchParams.get('fromDate');
        const toDateStr = searchParams.get('toDate');
        const branchIdParam = searchParams.get('branchId');
        const centerIdParam = searchParams.get('centerId');

        if (!fromDateStr || !toDateStr) {
            return NextResponse.json(
                { error: 'fromDate and toDate are required' },
                { status: 400 }
            );
        }

        const branchIds = await resolveScopedBranchIds(user, branchIdParam);
        const data = await getPreclosureRows({
            fromDate: fromDateStr,
            toDate: toDateStr,
            branchIds,
            centerId: centerIdParam,
        });

        return NextResponse.json({
            success: true,
            data,
            count: data.length,
        });
    } catch (error) {
        console.error('Error fetching preclosure report details:', error);
        return NextResponse.json(
            {
                error: 'Failed to fetch preclosure report details',
                details: error instanceof Error ? error.message : 'Unknown error',
            },
            { status: 500 }
        );
    }
    })(req);
}
