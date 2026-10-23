import { NextRequest } from 'next/server';
import { handleCorsPreflight, successResponse } from '@/app/lib/api-utils';
import { withStaffLoanActor } from '@/app/lib/staff-loans/application-access';
import { advanceCapabilities } from '@/app/lib/staff-advances/service';

export function OPTIONS() { return handleCorsPreflight(); }

// GET /api/hr/staff-advances/capabilities — which lists (management / approvals / repayment) this user may open
export function GET(request: NextRequest) {
    return withStaffLoanActor(async (_req, actor) => successResponse(await advanceCapabilities(actor)))(request);
}
