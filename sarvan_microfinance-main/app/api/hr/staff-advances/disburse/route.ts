import { NextRequest } from 'next/server';
import { handleCorsPreflight, successResponse } from '@/app/lib/api-utils';
import { withStaffLoanActor } from '@/app/lib/staff-loans/application-access';
import { disburseAdvance } from '@/app/lib/staff-advances/service';

export function OPTIONS() { return handleCorsPreflight(); }

// POST /api/hr/staff-advances/disburse — a disbursement-authority holder pays out an approved advance
export function POST(request: NextRequest) {
    return withStaffLoanActor(async (req, actor) => successResponse(await disburseAdvance(actor, await req.json()), 'Staff advance disbursed'))(request);
}
