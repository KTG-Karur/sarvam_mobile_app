import { NextRequest } from 'next/server';
import { handleCorsPreflight, successResponse } from '@/app/lib/api-utils';
import { withStaffLoanActor } from '@/app/lib/staff-loans/application-access';
import { cancelApplication } from '@/app/lib/staff-loans/application-service';
import { cancelSchema } from '@/app/lib/staff-loans/application';
export function OPTIONS() { return handleCorsPreflight(); }
export function POST(request: NextRequest) {
    return withStaffLoanActor(async (req, actor) => {
        const input = cancelSchema.parse(await req.json());
        return successResponse(await cancelApplication(actor, input.id, input.expectedVersion), 'Application cancelled');
    })(request);
}
