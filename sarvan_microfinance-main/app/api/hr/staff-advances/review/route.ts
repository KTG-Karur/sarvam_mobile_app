import { NextRequest } from 'next/server';
import { handleCorsPreflight, successResponse } from '@/app/lib/api-utils';
import { withStaffLoanActor } from '@/app/lib/staff-loans/application-access';
import { reviewAdvance } from '@/app/lib/staff-advances/service';

export function OPTIONS() { return handleCorsPreflight(); }

// POST /api/hr/staff-advances/review — { id, expectedVersion, action: 'APPROVE' | 'REJECT', remarks }
export function POST(request: NextRequest) {
    return withStaffLoanActor(async (req, actor) => successResponse(await reviewAdvance(actor, await req.json()), 'Review recorded'))(request);
}
