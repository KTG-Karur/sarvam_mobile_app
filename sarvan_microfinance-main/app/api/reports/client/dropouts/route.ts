import { NextRequest, NextResponse } from 'next/server';
import { withRole } from '@/app/lib/api-utils';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';
import { getDropoutsRows } from '@/app/lib/reports/queries/batch1';

export async function GET(request: NextRequest) {
    return withRole(['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'], async (req, user) => {
        try {
            const searchParams = req.nextUrl.searchParams;
            const centerId = searchParams.get('centerId');
            const branchId = searchParams.get('branchId') || undefined;
            const fromDateStr = searchParams.get('fromDate');
            const tillDateStr = searchParams.get('tillDate');

            if (!fromDateStr || !tillDateStr) {
                return NextResponse.json(
                    { error: 'From Date and Till Date are required' },
                    { status: 400 }
                );
            }

            const permitted = await resolveScopedBranchIds(user, branchId);
            const formattedData = await getDropoutsRows({
                fromDate: fromDateStr,
                toDate: tillDateStr,
                branchIds: permitted,
                centerId,
            });

            return NextResponse.json(formattedData);
        } catch (error) {
            console.error('Error fetching client dropouts:', error);
            return NextResponse.json(
                { error: 'Failed to fetch client dropouts report' },
                { status: 500 }
            );
        }
    })(request);
}
