import { NextRequest, NextResponse } from 'next/server';
import { getOSClientwiseData } from '@/app/lib/actions/reports';
import { withRole } from '@/app/lib/api-utils';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function GET(request: NextRequest) {
    return withRole(['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'], async (req, user) => {
    try {
        const searchParams = req.nextUrl.searchParams;
        const reportDate = searchParams.get('reportDate') || new Date().toISOString().split('T')[0];
        const page = parseInt(searchParams.get('page') || '1');
        const pageSize = parseInt(searchParams.get('pageSize') || '10');
        const centerId = searchParams.get('centerId') || undefined;
        const funderId = searchParams.get('funderId') || undefined;
        const search = searchParams.get('search') || undefined;
        const branchIdParam = searchParams.get('branchId');
        const exportAll = searchParams.get('exportAll') === 'true';

        const branchIds = await resolveScopedBranchIds(user, branchIdParam);

        const result = await getOSClientwiseData(reportDate, page, pageSize, {
            centerId,
            funderId,
            search,
            branchId: branchIds ?? undefined,
        }, exportAll);

        return NextResponse.json(result);
    } catch (error) {
        console.error('Error fetching OS clientwise data:', error);
        return NextResponse.json(
            { error: 'Failed to fetch OS clientwise data' },
            { status: 500 }
        );
    }
    })(request);
}
