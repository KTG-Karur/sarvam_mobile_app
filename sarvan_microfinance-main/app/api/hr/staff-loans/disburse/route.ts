import { NextRequest } from 'next/server';
import { handleCorsPreflight, successResponse } from '@/app/lib/api-utils';
import { withStaffLoanActor } from '@/app/lib/staff-loans/application-access';
import { disburseLoan } from '@/app/lib/staff-loans/application-service';
import { disburseSchema } from '@/app/lib/staff-loans/application';

export function OPTIONS() {
    return handleCorsPreflight();
}

export function POST(request: NextRequest) {
    return withStaffLoanActor(async (req, actor) => {
        const input = disburseSchema.parse(await req.json());
        return successResponse(await disburseLoan(actor, input), 'Loan disbursed successfully');
    })(request);
}
