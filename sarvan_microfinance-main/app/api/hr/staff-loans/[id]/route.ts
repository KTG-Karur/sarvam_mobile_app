import { NextRequest } from 'next/server';
import { handleCorsPreflight, successResponse } from '@/app/lib/api-utils';
import { withStaffLoanActor } from '@/app/lib/staff-loans/application-access';
import { applicationDetail, editApplicationTerms } from '@/app/lib/staff-loans/application-service';
import { editTermsSchema } from '@/app/lib/staff-loans/application';
export function OPTIONS() { return handleCorsPreflight(); }
export function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    return withStaffLoanActor(async (_req, actor) => successResponse(await applicationDetail(actor, (await context.params).id)))(request);
}
// PATCH /api/hr/staff-loans/[id] — an approver adjusts amount / tenure / interest rate / purpose while
// the application is under review. Authorization (current-stage reviewer or admin) is enforced in the service.
export function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    return withStaffLoanActor(async (req, actor) => successResponse(
        await editApplicationTerms(actor, (await context.params).id, editTermsSchema.parse(await req.json())),
        'Loan terms updated',
    ))(request);
}
