import { NextRequest } from 'next/server';
import { handleCorsPreflight, successResponse } from '@/app/lib/api-utils';
import { withStaffLoanActor } from '@/app/lib/staff-loans/application-access';
import { reviewApplication } from '@/app/lib/staff-loans/application-service';
import { reviewSchema } from '@/app/lib/staff-loans/application';
export function OPTIONS() { return handleCorsPreflight(); }
export function POST(request: NextRequest) {
    return withStaffLoanActor(async (req, actor) => successResponse(await reviewApplication(actor, reviewSchema.parse(await req.json())), 'Review recorded'))(request);
}
