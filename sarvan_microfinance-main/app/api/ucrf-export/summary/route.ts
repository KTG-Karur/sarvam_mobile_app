import { NextRequest } from 'next/server';
import { errorResponse, handleCorsPreflight, successResponse } from '@/app/lib/api-utils';
import { withUcrfAdmin } from '@/app/lib/ucrf/admin-guard';
import { getCachedUcrfRecords, summarize, UcrfDataNotReadyError } from '@/app/lib/ucrf/dataset.service';
import { lastSuccessfulExport, loadConfigForRequest, parseFilters, todayYmd, UcrfRequestError } from '@/app/lib/ucrf/request-context';
import { validateFileLevel } from '@/app/lib/ucrf/validate';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/** POST /api/ucrf-export/summary — card statistics for the selected filters (ADMIN only). */
export async function POST(request: NextRequest) {
    return withUcrfAdmin(async (req) => {
        try {
            const body = (await req.json()) as { filters?: unknown };
            const filters = parseFilters(body.filters);
            const { saved, config, version } = await loadConfigForRequest();
            const records = getCachedUcrfRecords(filters, version);
            if (!records) throw new UcrfDataNotReadyError();
            return successResponse({
                configSaved: saved,
                fileLevelErrors: validateFileLevel(saved ? config : null, filters.reportDate, todayYmd()),
                summary: summarize(records, filters.reportDate),
                lastExport: await lastSuccessfulExport(),
            });
        } catch (error) {
            if (error instanceof UcrfDataNotReadyError) return errorResponse(error.message, 409);
            if (error instanceof UcrfRequestError) return errorResponse(error.message, error.status);
            console.error('[ucrf-export] summary failed', error instanceof Error ? error.message : error);
            return errorResponse('Failed to calculate the UCRF summary', 500);
        }
    })(request);
}
