import { NextRequest, NextResponse } from 'next/server';
import { withRole } from '@/app/lib/api-utils';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';
import { getFutureReportRows } from '@/app/lib/reports/queries/batch4';

export async function GET(req: NextRequest) {
    const handler = withRole(
        ['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER', 'FDO'],
        async (req, user) => {
            try {
                const searchParams = req.nextUrl.searchParams;
                const fromDate = searchParams.get('fromDate');
                const toDate = searchParams.get('toDate');
                const branchId = searchParams.get('branchId') || undefined;
                const centerId = searchParams.get('centerId') || undefined;
                const page = parseInt(searchParams.get('page') || '1');
                const pageSize = parseInt(searchParams.get('pageSize') || '20');

                if (!fromDate || !toDate) {
                    return NextResponse.json(
                        { error: 'From Date and To Date are required' },
                        { status: 400 }
                    );
                }

                // Scope to user's branch for BM/FDO; AREA_MANAGER restricted to their
                // assigned branches (fails safe — a client-supplied branchId outside
                // the caller's permitted set is ignored, never honored).
                const scopedBranchIds = await resolveScopedBranchIds(user, branchId ?? null);
                const result = await getFutureReportRows({ fromDate, toDate, branchIds: scopedBranchIds, centerId, page, pageSize, search: searchParams.get('search') });

                return NextResponse.json(result);
            } catch (error) {
                console.error('Error fetching Future Report data:', error);
                return NextResponse.json(
                    { error: 'Failed to fetch Future Report data' },
                    { status: 500 }
                );
            }
        }
    );

    return handler(req);
}

export async function OPTIONS() {
    return new NextResponse(null, { status: 204 });
}
