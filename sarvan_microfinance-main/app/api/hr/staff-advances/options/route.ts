import { NextRequest } from 'next/server';
import { handleCorsPreflight, successResponse } from '@/app/lib/api-utils';
import { withStaffLoanActor } from '@/app/lib/staff-loans/application-access';
import { advanceOptions } from '@/app/lib/staff-advances/service';

export function OPTIONS() { return handleCorsPreflight(); }

// GET /api/hr/staff-advances/options?employeeId= — employee, salary summary, existing loans/advances for the apply form
export function GET(request: NextRequest) {
    return withStaffLoanActor(async (req, actor) =>
        successResponse(await advanceOptions(actor, req.nextUrl.searchParams.get('employeeId') ?? undefined)),
    )(request);
}
