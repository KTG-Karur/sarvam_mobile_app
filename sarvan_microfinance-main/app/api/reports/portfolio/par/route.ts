import { NextRequest, NextResponse } from 'next/server';
import { getPortfolioAtRiskData } from '@/app/lib/actions/reports';
import { withRole } from '@/app/lib/api-utils';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function GET(req: NextRequest) {
    return withRole(['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'], async (request, user) => {
    try {
        const { searchParams } = new URL(request.url);
        const centerId = searchParams.get('centerId') || 'all';
        const branchIdParam = searchParams.get('branchId');

        const branchIds = await resolveScopedBranchIds(user, branchIdParam);
        const result = await getPortfolioAtRiskData(centerId, branchIds ?? undefined);

        return NextResponse.json({
            success: true,
            data: result.data,
            totals: result.totals,
            message: 'PAR data fetched successfully',
        });
    } catch (error) {
        console.error('Error in PAR API route:', error);
        return NextResponse.json(
            { error: 'Failed to fetch Portfolio At Risk data' },
            { status: 500 }
        );
    }
    })(req);
}
