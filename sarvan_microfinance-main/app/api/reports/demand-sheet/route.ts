import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { getDemandSheetClientWiseTableData, getDemandSheetData } from '@/app/lib/actions/demand';

const DEMAND_SHEET_ROLES = [
    'ADMIN',
    'BRANCH_MANAGER',
    'FDO',
    'AREA_MANAGER',
] as const;

const querySchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
    fdoId: z.string().min(1, 'fdoId is required (use "all" for all FDOs)'),
    type: z.enum(['centerwise', 'clientwise']).optional().default('centerwise'),
    /** @deprecated Ignored. */
    mode: z.enum(['pending', 'collected']).optional(),
});

function zodErrorMessage(err: z.ZodError): string {
    return err.errors.map((e) => `${e.path.join('.') || 'query'}: ${e.message}`).join('; ');
}

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * GET /api/reports/demand-sheet
 * Query: date=YYYY-MM-DD, fdoId=...|all, type=centerwise|clientwise (default centerwise).
 * Clientwise: clients with dues (demand/arrear) for the date and/or demand-side collection that day; `collected` excludes advance. `mode` ignored.
 * Auth: Cookie accessToken or Authorization: Bearer <token>. Optional X-Branch-Id for ADMIN/AM.
 */
export async function GET(request: NextRequest) {
    const handler = withRole([...DEMAND_SHEET_ROLES], async (req) => {
        const parsed = querySchema.safeParse({
            date: req.nextUrl.searchParams.get('date'),
            fdoId: req.nextUrl.searchParams.get('fdoId'),
            type: req.nextUrl.searchParams.get('type') ?? undefined,
            mode: req.nextUrl.searchParams.get('mode') ?? undefined,
        });

        if (!parsed.success) {
            return errorResponse(zodErrorMessage(parsed.error), 400);
        }

        const { date, fdoId, type } = parsed.data;

        try {
            if (type === 'centerwise') {
                const rows = await getDemandSheetData(date, fdoId, 'centerwise');
                return successResponse(
                    { type: 'centerwise' as const, date, fdoId, rows },
                    `Loaded ${rows.length} center row(s)`
                );
            }

            const rows = await getDemandSheetClientWiseTableData(date, fdoId);
            return successResponse(
                { type: 'clientwise' as const, date, fdoId, rows },
                `Loaded ${rows.length} client row(s)`
            );
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'Failed to load demand sheet';
            return errorResponse(msg, 500);
        }
    });

    return handler(request);
}
