import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withRole, successResponse, errorResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { authorizeBranchSelection } from '@/app/lib/reports/profit-loss';
import { ProfitLossBranchError } from '@/app/lib/reports/profit-loss-service';
import { computeBalanceSheetReport } from '@/app/lib/reports/balance-sheet-service';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const querySchema = z.object({
    asOnDate: z
        .string({ required_error: 'As On Date is required' })
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
        .refine((s) => new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), 'Invalid date'),
    mode: z.enum(['GROUP', 'ACCOUNT']).default('GROUP'),
    branchId: z.string().min(1).optional(),
});

export async function GET(req: NextRequest) {
    return withRole(['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'], async (request, user) => {
        try {
            const sp = new URL(request.url).searchParams;
            const parsed = querySchema.parse({
                asOnDate: sp.get('asOnDate') ?? undefined,
                mode: sp.get('mode') ?? undefined,
                branchId: sp.get('branchId') ?? undefined,
            });

            const permitted = await getPermittedBranchIds(user);
            const auth = authorizeBranchSelection(permitted, parsed.branchId);
            if (!auth.ok) return errorResponse(auth.reason, 403);

            const report = await computeBalanceSheetReport({ asOnDate: parsed.asOnDate, mode: parsed.mode, branchIds: auth.branchIds });
            return successResponse(report);
        } catch (error: unknown) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            if (error instanceof ProfitLossBranchError) return errorResponse(error.message, 404);
            console.error('Balance Sheet error:', error);
            return errorResponse('Failed to generate Balance Sheet report', 500);
        }
    })(req);
}
