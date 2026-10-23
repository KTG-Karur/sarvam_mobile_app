import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
    handleCorsPreflight,
    errorResponse,
    successResponse,
    withRole,
} from '@/app/lib/api-utils';
import { getDemandSheetClientWiseCenterReport } from '@/app/lib/actions/demand';

const DEMAND_SHEET_ROLES = [
    'ADMIN',
    'BRANCH_MANAGER',
    'FDO',
    'AREA_MANAGER',
] as const;

const querySchema = z.object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
    fdoId: z.string().min(1, 'fdoId is required (use "all" for all FDOs)'),
    centerId: z.string().min(1, 'centerId is required'),
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
 * GET /api/reports/demand-sheet/client-report
 * Per-center detailed client-wise demand report (same payload as the web dialog).
 * Query: date=YYYY-MM-DD, fdoId=...|all, centerId=... (`mode` ignored; same client inclusion as clientwise table).
 */
export async function GET(request: NextRequest) {
    const handler = withRole([...DEMAND_SHEET_ROLES], async (req) => {
        const parsed = querySchema.safeParse({
            date: req.nextUrl.searchParams.get('date'),
            fdoId: req.nextUrl.searchParams.get('fdoId'),
            centerId: req.nextUrl.searchParams.get('centerId'),
            mode: req.nextUrl.searchParams.get('mode') ?? undefined,
        });

        if (!parsed.success) {
            return errorResponse(zodErrorMessage(parsed.error), 400);
        }

        const { date, fdoId, centerId } = parsed.data;

        try {
            const data = await getDemandSheetClientWiseCenterReport(date, fdoId, centerId);
            return successResponse(data);
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'Failed to load client report';
            if (msg === 'Center not found') {
                return errorResponse(msg, 404);
            }
            if (msg === 'Unauthorized center access') {
                return errorResponse(msg, 403);
            }
            if (msg.startsWith('No demand sheet for this center on the selected date')) {
                return errorResponse(msg, 404);
            }
            return errorResponse(msg, 500);
        }
    });

    return handler(request);
}
