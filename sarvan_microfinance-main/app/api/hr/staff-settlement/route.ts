import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handleCorsPreflight, successResponse } from '@/app/lib/api-utils';
import { withStaffLoanActor } from '@/app/lib/staff-loans/application-access';
import { getSettlementDetail, listSettlementCandidates, settlementCapabilities, submitSettlement } from '@/app/lib/staff-settlement/service';
import { staffSettlementSchema } from '@/app/lib/staff-settlement/settlement';

const querySchema = z.object({
    type: z.enum(['LOAN', 'ADVANCE']).optional(),
    id: z.string().min(1).optional(),
    search: z.string().max(100).optional(),
    branchId: z.string().min(1).optional().transform((v) => (v === 'all' ? undefined : v)),
    role: z.string().min(1).max(50).optional(),
    departmentId: z.string().min(1).optional(),
});

export function OPTIONS() {
    return handleCorsPreflight();
}

// GET ?                     -> what this user may do (which tabs to show)
// GET ?type=&search=&branchId=&role=&departmentId= -> ACTIVE loans / advances that can be settled
// GET ?type=&id=            -> settlement details of one loan / advance
export function GET(request: NextRequest) {
    return withStaffLoanActor(async (req, actor) => {
        const { searchParams } = new URL(req.url);
        const query = querySchema.parse({
            type: searchParams.get('type') ?? undefined,
            id: searchParams.get('id') ?? undefined,
            search: searchParams.get('search') ?? undefined,
            branchId: searchParams.get('branchId') ?? undefined,
            role: searchParams.get('role') ?? undefined,
            departmentId: searchParams.get('departmentId') ?? undefined,
        });
        if (!query.type) return successResponse(settlementCapabilities(actor));
        if (query.id) return successResponse(await getSettlementDetail(actor, query.type, query.id));
        return successResponse(await listSettlementCandidates(actor, query.type, {
            search: query.search, branchId: query.branchId, role: query.role, departmentId: query.departmentId,
        }));
    })(request);
}

export function POST(request: NextRequest) {
    return withStaffLoanActor(async (req, actor) => {
        const input = staffSettlementSchema.parse(await req.json());
        const result = await submitSettlement(actor, input);
        return successResponse(result, `Staff ${result.type === 'LOAN' ? 'loan' : 'advance'} settled successfully`);
    })(request);
}
