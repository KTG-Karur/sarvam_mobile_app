import { NextRequest } from 'next/server';
import { handleCorsPreflight, successResponse } from '@/app/lib/api-utils';
import { withStaffLoanActor } from '@/app/lib/staff-loans/application-access';
import {
    getLoanRepaymentDetails,
    listActiveLoansForRepayment,
    recordRepayment,
} from '@/app/lib/staff-loans/application-service';
import { repaymentSchema } from '@/app/lib/staff-loans/application';

export function OPTIONS() {
    return handleCorsPreflight();
}

export function GET(request: NextRequest) {
    return withStaffLoanActor(async (req, actor) => {
        const { searchParams } = new URL(req.url);
        const loanId = searchParams.get('loanId');
        if (loanId) {
            const details = await getLoanRepaymentDetails(loanId, actor);
            return successResponse(details);
        }
        const search = searchParams.get('search') || undefined;
        const list = await listActiveLoansForRepayment(actor, search);
        return successResponse(list);
    })(request);
}

export function POST(request: NextRequest) {
    return withStaffLoanActor(async (req, actor) => {
        const body = await req.json();
        const input = repaymentSchema.parse(body);
        const result = await recordRepayment(input, actor);
        return successResponse(result, 'Repayment recorded successfully');
    })(request);
}
