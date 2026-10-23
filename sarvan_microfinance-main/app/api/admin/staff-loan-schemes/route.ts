import { NextRequest } from 'next/server';
import { handleCorsPreflight, successResponse } from '@/app/lib/api-utils';
import { SCHEME_PAGE, schemeCreateSchema, schemeUpdateSchema } from '@/app/lib/staff-loans/configuration';
import { withStaffLoanMaster } from '@/app/lib/staff-loans/configuration-api';
import { listStaffLoanSchemes, saveStaffLoanScheme } from '@/app/lib/staff-loans/configuration-service';

export function OPTIONS() { return handleCorsPreflight(); }
export function GET(request: NextRequest) {
    return withStaffLoanMaster(SCHEME_PAGE, 'view', async (_req, _actorId, capabilities) =>
        successResponse({ ...await listStaffLoanSchemes(), capabilities })
    )(request);
}
export function POST(request: NextRequest) {
    return withStaffLoanMaster(SCHEME_PAGE, 'add', async (req, actorId) => {
        const { scheme } = schemeCreateSchema.parse(await req.json());
        return successResponse(await saveStaffLoanScheme(scheme, actorId), 'Staff loan scheme created');
    })(request);
}
export function PUT(request: NextRequest) {
    return withStaffLoanMaster(SCHEME_PAGE, 'edit', async (req, actorId) => {
        const { scheme, id, expectedVersion } = schemeUpdateSchema.parse(await req.json());
        return successResponse(await saveStaffLoanScheme(scheme, actorId, { id, expectedVersion }), 'Staff loan scheme updated');
    })(request);
}
