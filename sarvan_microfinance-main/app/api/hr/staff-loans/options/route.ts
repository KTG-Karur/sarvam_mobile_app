import { NextRequest } from 'next/server';
import { handleCorsPreflight, successResponse } from '@/app/lib/api-utils';
import { withStaffLoanActor } from '@/app/lib/staff-loans/application-access';
import { applicationOptions } from '@/app/lib/staff-loans/application-service';
export function OPTIONS() { return handleCorsPreflight(); }
export function GET(request: NextRequest) {
    return withStaffLoanActor(async (req, actor) => {
        const employeeId = req.nextUrl.searchParams.get('employeeId') ?? undefined;
        return successResponse(await applicationOptions(actor, employeeId));
    })(request);
}
