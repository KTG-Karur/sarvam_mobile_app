import { NextRequest } from 'next/server';
import { handleCorsPreflight, successResponse } from '@/app/lib/api-utils';
import { withStaffLoanActor } from '@/app/lib/staff-loans/application-access';
import { managementCapabilities } from '@/app/lib/staff-loans/application-service';
export function OPTIONS() { return handleCorsPreflight(); }
export function GET(request: NextRequest) {
    return withStaffLoanActor(async (_req, actor) => successResponse(await managementCapabilities(actor)))(request);
}
