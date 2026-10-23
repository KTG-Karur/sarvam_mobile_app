import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handleCorsPreflight, successResponse } from '@/app/lib/api-utils';
import { withStaffLoanActor } from '@/app/lib/staff-loans/application-access';
import { listApplications, saveApplication } from '@/app/lib/staff-loans/application-service';
import { saveApplicationSchema } from '@/app/lib/staff-loans/application';

export function OPTIONS() { return handleCorsPreflight(); }
export function GET(request: NextRequest) {
    return withStaffLoanActor(async (req, actor) => {
        const tab = z.enum(['own', 'register', 'approvals', 'disbursements']).parse(req.nextUrl.searchParams.get('tab') ?? 'own');
        const page = z.coerce.number().int().positive().max(100000000).parse(req.nextUrl.searchParams.get('page') ?? 1);
        return successResponse(await listApplications(actor, tab, page));
    })(request);
}
export function POST(request: NextRequest) {
    return withStaffLoanActor(async (req, actor) => {
        const input = saveApplicationSchema.parse(await req.json());
        return successResponse(await saveApplication(actor, input.application, input.submit,
            input.id && input.expectedVersion ? { id: input.id, expectedVersion: input.expectedVersion } : undefined),
            input.submit ? 'Staff loan application submitted' : 'Staff loan draft saved');
    })(request);
}
