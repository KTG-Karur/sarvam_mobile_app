import { NextRequest } from 'next/server';
import { handleCorsPreflight, successResponse } from '@/app/lib/api-utils';
import { withStaffLoanActor } from '@/app/lib/staff-loans/application-access';
import { staffLoanDocumentAccess } from '@/app/lib/staff-loans/application-service';

export function OPTIONS() { return handleCorsPreflight(); }
// GET /api/hr/staff-loans/[id]/document — short-lived signed URL for the application's supporting
// document, available to anyone who may see the application (applicant, reviewers, register).
export function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
    return withStaffLoanActor(async (_req, actor) => successResponse(await staffLoanDocumentAccess(actor, (await context.params).id)))(request);
}
