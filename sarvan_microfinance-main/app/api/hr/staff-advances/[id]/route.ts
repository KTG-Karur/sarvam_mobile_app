import { NextRequest } from 'next/server';
import { handleCorsPreflight, successResponse } from '@/app/lib/api-utils';
import { withStaffLoanActor } from '@/app/lib/staff-loans/application-access';
import { advanceEditSchema } from '@/app/lib/staff-advances/advance';
import { advanceDetail, editAdvance } from '@/app/lib/staff-advances/service';

export function OPTIONS() { return handleCorsPreflight(); }

export function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    return withStaffLoanActor(async (_req, actor) => successResponse(await advanceDetail(actor, (await context.params).id)))(request);
}

// PATCH /api/hr/staff-advances/[id] — the current-stage reviewer (or admin) edits amount / reason / remarks
// while the advance is under review. Authorization is enforced in the service.
export function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    return withStaffLoanActor(async (req, actor) => successResponse(
        await editAdvance(actor, (await context.params).id, advanceEditSchema.parse(await req.json())),
        'Staff advance updated',
    ))(request);
}
