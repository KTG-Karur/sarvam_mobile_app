import { NextRequest, NextResponse } from 'next/server';
import { getPreclosureReportData } from '@/app/lib/actions/reports';
import { withRole } from '@/app/lib/api-utils';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function GET(req: NextRequest) {
    return withRole(['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'], async (request, user) => {
    try {
        const { searchParams } = new URL(request.url);
        const branchIdParam = searchParams.get('branchId');
        const fromDate = searchParams.get('fromDate');
        const tillDate = searchParams.get('tillDate');

        if (!fromDate || !tillDate) {
            return NextResponse.json(
                { error: 'From Date and Till Date are required' },
                { status: 400 }
            );
        }

        const branchIds = await resolveScopedBranchIds(user, branchIdParam);
        const data = await getPreclosureReportData(branchIds ?? 'all', fromDate, tillDate);

        return NextResponse.json({ success: true, data, message: 'Preclosure data fetched successfully' });
    } catch (error) {
        console.error('Error in Preclosure API route:', error);
        return NextResponse.json(
            { error: 'Failed to fetch Preclosure data' },
            { status: 500 }
        );
    }
    })(req);
}
