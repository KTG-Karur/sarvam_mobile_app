import { NextRequest } from 'next/server';
import { handleCorsPreflight, successResponse } from '@/app/lib/api-utils';
import { withStaffLoanActor } from '@/app/lib/staff-loans/application-access';
import { cancelAdvance } from '@/app/lib/staff-advances/service';

export function OPTIONS() { return handleCorsPreflight(); }

// POST /api/hr/staff-advances/cancel — { id, expectedVersion }: the applicant withdraws an advance under review
export function POST(request: NextRequest) {
    return withStaffLoanActor(async (req, actor) => successResponse(await cancelAdvance(actor, await req.json()), 'Application cancelled'))(request);
}
