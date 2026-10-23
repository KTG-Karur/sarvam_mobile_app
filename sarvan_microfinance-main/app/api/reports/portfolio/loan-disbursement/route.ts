import { NextRequest, NextResponse } from 'next/server';
import { getLoanDisbursementData } from '@/app/lib/actions/reports';
import { withRole } from '@/app/lib/api-utils';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function GET(request: NextRequest) {
    return withRole(['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'], async (req, user) => {
    try {
        const searchParams = req.nextUrl.searchParams;
        const centerId = searchParams.get('centerId') || 'all';
        const fromDate = searchParams.get('fromDate');
        const tillDate = searchParams.get('tillDate');
        const branchIdParam = searchParams.get('branchId');

        if (!fromDate || !tillDate) {
            return NextResponse.json(
                { error: 'fromDate and tillDate are required' },
                { status: 400 }
            );
        }

        const branchIds = await resolveScopedBranchIds(user, branchIdParam);
        const data = await getLoanDisbursementData(centerId, fromDate, tillDate, branchIds ?? undefined);

        return NextResponse.json({
            success: true,
            data,
            message: 'Loan disbursement data fetched successfully'
        });
    } catch (error: any) {
        console.error('Error fetching loan disbursement data:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to fetch loan disbursement data' },
            { status: 500 }
        );
    }
    })(request);
}
