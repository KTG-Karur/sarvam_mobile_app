import { NextRequest } from 'next/server';
import { z } from 'zod';
import { errorResponse, handleCorsPreflight, successResponse } from '@/app/lib/api-utils';
import { withUcrfAdmin } from '@/app/lib/ucrf/admin-guard';
import { getUcrfJobStatus, startUcrfJob } from '@/app/lib/ucrf/job.service';
import { loadConfigForRequest, parseFilters, UcrfRequestError } from '@/app/lib/ucrf/request-context';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const bodySchema = z.object({ action: z.enum(['start', 'status']), filters: z.unknown() });

/** POST /api/ucrf-export/job — start the background calculation for the filters, or poll its progress (ADMIN only). */
export async function POST(request: NextRequest) {
    return withUcrfAdmin(async (req) => {
        try {
            const body = bodySchema.parse(await req.json());
            const filters = parseFilters(body.filters);
            const { config, version } = await loadConfigForRequest();
            if (body.action === 'status') return successResponse(getUcrfJobStatus(filters, version));
            const started = startUcrfJob(filters, config, version);
            if (!started.ok) return errorResponse(started.reason, 409);
            return successResponse(started.status);
        } catch (error) {
            if (error instanceof UcrfRequestError) return errorResponse(error.message, error.status);
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            console.error('[ucrf-export] job failed', error instanceof Error ? error.message : error);
            return errorResponse('Failed to run the UCRF calculation', 500);
        }
    })(request);
}
