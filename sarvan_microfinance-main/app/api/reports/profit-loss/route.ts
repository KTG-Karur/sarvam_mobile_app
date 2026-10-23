import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withRole, successResponse, errorResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { authorizeBranchSelection } from '@/app/lib/reports/profit-loss';
import { computeProfitLossReport, ProfitLossBranchError } from '@/app/lib/reports/profit-loss-service';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const ymd = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
    .refine((s) => new Date(`${s}T00:00:00Z`).toISOString().startsWith(s), 'Invalid date');

const querySchema = z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('AS_ON'), asOnDate: ymd, branchId: z.string().min(1).optional() }),
    z.object({ mode: z.literal('RANGE'), fromDate: ymd, toDate: ymd, branchId: z.string().min(1).optional() }),
]);

export async function GET(req: NextRequest) {
    return withRole(['ADMIN', 'BRANCH_MANAGER', 'AREA_MANAGER'], async (request, user) => {
        try {
            const sp = new URL(request.url).searchParams;
            const parsed = querySchema.parse({
                mode: sp.get('mode') ?? 'AS_ON',
                asOnDate: sp.get('asOnDate') ?? undefined,
                fromDate: sp.get('fromDate') ?? undefined,
                toDate: sp.get('toDate') ?? undefined,
                branchId: sp.get('branchId') ?? undefined,
            });
            if (parsed.mode === 'RANGE' && parsed.fromDate > parsed.toDate) {
                return errorResponse('From Date cannot be after To Date', 400);
            }

            const permitted = await getPermittedBranchIds(user);
            const auth = authorizeBranchSelection(permitted, parsed.branchId);
            if (!auth.ok) return errorResponse(auth.reason, 403);

            const report = await computeProfitLossReport({
                mode: parsed.mode,
                fromDate: parsed.mode === 'RANGE' ? parsed.fromDate : null,
                toDate: parsed.mode === 'RANGE' ? parsed.toDate : null,
                asOnDate: parsed.mode === 'AS_ON' ? parsed.asOnDate : null,
                branchIds: auth.branchIds,
            });
            return successResponse(report);
        } catch (error: unknown) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            if (error instanceof ProfitLossBranchError) return errorResponse(error.message, 404);
            console.error('Profit & Loss error:', error);
            return errorResponse('Failed to generate Profit & Loss report', 500);
        }
    })(req);
}
