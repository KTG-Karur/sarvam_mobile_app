import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handleCorsPreflight, successResponse } from '@/app/lib/api-utils';
import { withStaffLoanActor } from '@/app/lib/staff-loans/application-access';
import { advanceApplicationSchema } from '@/app/lib/staff-advances/advance';
import { applyForAdvance, listAdvances } from '@/app/lib/staff-advances/service';

export function OPTIONS() { return handleCorsPreflight(); }

// GET /api/hr/staff-advances?tab=own|register|approvals|disbursements|repayment&page=
export function GET(request: NextRequest) {
    return withStaffLoanActor(async (req, actor) => {
        const tab = z.enum(['own', 'register', 'approvals', 'disbursements']).parse(req.nextUrl.searchParams.get('tab') ?? 'own');
        const page = z.coerce.number().int().positive().max(100000000).parse(req.nextUrl.searchParams.get('page') ?? 1);
        return successResponse(await listAdvances(actor, tab, page));
    })(request);
}

// POST /api/hr/staff-advances — apply for a staff advance (own, or on behalf where permitted)
export function POST(request: NextRequest) {
    return withStaffLoanActor(async (req, actor) => {
        const input = advanceApplicationSchema.parse(await req.json());
        return successResponse(await applyForAdvance(actor, input), 'Staff advance application submitted');
    })(request);
}
