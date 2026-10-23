import { NextRequest } from 'next/server';
import { handleCorsPreflight, successResponse } from '@/app/lib/api-utils';
import { withStaffLoanActor } from '@/app/lib/staff-loans/application-access';
import { advanceDocumentAccess } from '@/app/lib/staff-advances/service';

export function OPTIONS() { return handleCorsPreflight(); }
// GET /api/hr/staff-advances/[id]/document — short-lived signed URL for the application's supporting document,
// available to anyone who may see the advance (applicant, reviewers, register).
export function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    return withStaffLoanActor(async (_req, actor) => successResponse(await advanceDocumentAccess(actor, (await context.params).id)))(request);
}
