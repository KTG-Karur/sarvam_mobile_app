import { NextRequest } from 'next/server';
import { errorResponse, handleCorsPreflight, successResponse } from '@/app/lib/api-utils';
import { withUcrfAdmin } from '@/app/lib/ucrf/admin-guard';
import { applyValidityFilter, getCachedUcrfRecords, pageRecords, UcrfDataNotReadyError } from '@/app/lib/ucrf/dataset.service';
import { loadConfigForRequest, parseFilters, UcrfRequestError } from '@/app/lib/ucrf/request-context';
import { ucrfPageSchema } from '@/app/lib/ucrf/types';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/** POST /api/ucrf-export/preview — one server-paginated page of the records that would be exported (ADMIN only). */
export async function POST(request: NextRequest) {
    return withUcrfAdmin(async (req) => {
        try {
            const body = (await req.json()) as { filters?: unknown; page?: unknown };
            const filters = parseFilters(body.filters);
            const paging = ucrfPageSchema.parse(body.page ?? {});
            const { version } = await loadConfigForRequest();
            const cached = getCachedUcrfRecords(filters, version);
            if (!cached) throw new UcrfDataNotReadyError();
            const records = applyValidityFilter(cached, filters.validity);
            return successResponse(pageRecords(records, paging));
        } catch (error) {
            if (error instanceof UcrfDataNotReadyError) return errorResponse(error.message, 409);
            if (error instanceof UcrfRequestError) return errorResponse(error.message, error.status);
            if (error && typeof error === 'object' && 'issues' in error) return errorResponse('Invalid paging parameters', 400);
            console.error('[ucrf-export] preview failed', error instanceof Error ? error.message : error);
            return errorResponse('Failed to load the UCRF preview', 500);
        }
    })(request);
}
