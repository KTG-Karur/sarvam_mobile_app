import { NextRequest, NextResponse } from 'next/server';
import { getIndividualLedgerData } from '@/app/lib/actions/reports';
import { withRole } from '@/app/lib/api-utils';
import { resolveScopedBranchIds } from '@/app/lib/permissions/branch-scope';

export async function GET(request: NextRequest) {
    return withRole(['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'], async (req, user) => {
    try {
        const searchParams = req.nextUrl.searchParams;
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
        const data = await getIndividualLedgerData(fromDate, tillDate, branchIds ?? undefined);

        return NextResponse.json({
            success: true,
            data,
            message: 'Individual ledger data fetched successfully'
        });
    } catch (error: any) {
        console.error('Error fetching individual ledger data:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to fetch individual ledger data' },
            { status: 500 }
        );
    }
    })(request);
}
