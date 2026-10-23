import { NextRequest, NextResponse } from 'next/server';
import { getFutureDemandData } from '@/app/lib/actions/future-demand';
import { withRole } from '@/app/lib/api-utils';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function GET(req: NextRequest) {
    const handler = withRole(
        ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER', 'FDO'],
        async (req, user) => {
            try {
                const searchParams = req.nextUrl.searchParams;
                const fromDate = searchParams.get('fromDate');
                const toDate = searchParams.get('toDate');
                const reportType = (searchParams.get('reportType') as 'OFFICERWISE' | 'CENTERWISE' | 'CLIENTWISE' | 'BRANCHWISE') || 'OFFICERWISE';
                const page = parseInt(searchParams.get('page') || '1');
                const pageSize = parseInt(searchParams.get('pageSize') || '20');

                if (!fromDate || !toDate) {
                    return NextResponse.json(
                        { error: 'From Date and To Date are required' },
                        { status: 400 }
                    );
                }

                const branchIdParam = searchParams.get('branchId');
                const branchIds = await resolveScopedBranchIds(user, branchIdParam);
                const centerId = searchParams.get('centerId') || undefined;

                const result = await getFutureDemandData({
                    fromDate,
                    toDate,
                    reportType,
                    page,
                    pageSize,
                    branchId: branchIds ?? undefined,
                    centerId,
                    search: searchParams.get('search'),
                });

                return NextResponse.json(result);
            } catch (error) {
                console.error('Error fetching Future Demand data:', error);
                return NextResponse.json(
                    { error: 'Failed to fetch Future Demand data' },
                    { status: 500 }
                );
            }
        }
    );

    return handler(req);
}
