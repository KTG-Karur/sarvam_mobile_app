import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/app/lib/db';
import { corsHeaders, errorResponse, handleCorsPreflight } from '@/app/lib/api-utils';
import { getClientIp } from '@/app/lib/services/user-activity-tracker';
import { withUcrfAdmin } from '@/app/lib/ucrf/admin-guard';
import { configVersion, getUcrfConfig } from '@/app/lib/ucrf/config.service';
import { getCachedUcrfRecords, UcrfDataNotReadyError } from '@/app/lib/ucrf/dataset.service';
import { prepareExport, type ExportCounts } from '@/app/lib/ucrf/export.service';
import { parseFilters, todayYmd, UcrfRequestError } from '@/app/lib/ucrf/request-context';
import { ucrfExportBodySchema } from '@/app/lib/ucrf/types';

export async function OPTIONS() {
    return handleCorsPreflight();
}

async function audit(userId: string, ip: string | null, action: string, data: Record<string, unknown>) {
    try {
        // No member/KYC data — only filters, counts and file metadata.
        await prisma.roleAuditLog.create({
            data: { actedBy: userId, action, targetType: 'ucrf_export', targetId: String(data.filename ?? data.format ?? 'ucrf'), after: data as object, ipAddress: ip },
        });
    } catch (e) {
        console.error('[ucrf-export] audit log failed', e instanceof Error ? e.message : e);
    }
}

/**
 * POST /api/ucrf-export/export — generate CDF / CSV / XLSX / JSON / validation-error report.
 * All formats come from the same filtered, validated dataset. ADMIN only.
 */
export async function POST(request: NextRequest) {
    return withUcrfAdmin(async (req, user) => {
        const ip = getClientIp(req.headers);
        let format: string = 'unknown';
        let filters: ReturnType<typeof parseFilters> | null = null;
        try {
            const raw = (await req.json()) as { format?: unknown; filters?: unknown };
            const body = { format: ucrfExportBodySchema.shape.format.parse(raw.format) };
            format = body.format;
            filters = parseFilters(raw.filters);

            const config = await getUcrfConfig();
            if (!config) {
                return errorResponse('Save the institution settings (Member ID, institution name) before exporting', 422);
            }

            // Same snapshot the admin reviewed (built by the background job, keyed by filters + settings version),
            // so the file matches the confirmation-dialog counts. Never recalculates inside this request.
            const allRecords = getCachedUcrfRecords(filters, configVersion(config));
            if (!allRecords) throw new UcrfDataNotReadyError();
            const prepared = prepareExport({
                format: body.format,
                allRecords,
                filters,
                config,
                todayYmd: todayYmd(),
                createdYmd: todayYmd(),
                generatedAtIso: new Date().toISOString(),
                // Same bytes, just sent 100 records at a time with a short pause so other users' requests keep flowing.
                throttle: { rowsPerPull: 100, pauseMs: 100 },
            });

            if (!prepared.ok) {
                await audit(user.userId, ip, 'UCRF_EXPORT_BLOCKED', { format, reportDate: filters.reportDate, filters: auditFilters(filters), counts: prepared.counts, error: prepared.error });
                return errorResponse(prepared.error, prepared.status, prepared.counts);
            }

            await audit(user.userId, ip, 'UCRF_EXPORT_SUCCESS', {
                format,
                reportDate: filters.reportDate,
                filters: auditFilters(filters),
                counts: prepared.counts,
                included: prepared.counts.included,
                filename: prepared.filename,
            });

            return new NextResponse(prepared.body as BodyInit, {
                status: 200,
                headers: {
                    ...corsHeaders,
                    'Content-Type': prepared.contentType,
                    'Content-Disposition': `attachment; filename="${prepared.filename}"`,
                    'Cache-Control': 'no-store',
                    'X-Content-Type-Options': 'nosniff',
                    ...countHeaders(prepared.counts),
                    'Access-Control-Expose-Headers': 'Content-Disposition, X-Ucrf-Eligible, X-Ucrf-Valid, X-Ucrf-Invalid, X-Ucrf-Included, X-Ucrf-Excluded',
                },
            });
        } catch (error) {
            if (error instanceof UcrfDataNotReadyError) return errorResponse(error.message, 409);
            if (error instanceof UcrfRequestError) return errorResponse(error.message, error.status);
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            // Never leak stack traces / DB details to the client.
            console.error('[ucrf-export] export failed', error instanceof Error ? error.message : error);
            await audit(user.userId, ip, 'UCRF_EXPORT_FAILED', { format, reportDate: filters?.reportDate ?? null, error: 'internal error' });
            return errorResponse('Failed to generate the export', 500);
        }
    })(request);
}

function countHeaders(c: ExportCounts): Record<string, string> {
    return {
        'X-Ucrf-Eligible': String(c.eligible),
        'X-Ucrf-Valid': String(c.valid),
        'X-Ucrf-Invalid': String(c.invalid),
        'X-Ucrf-Included': String(c.included),
        'X-Ucrf-Excluded': String(c.excluded),
    };
}

/** Audit payloads carry filter choices but never the free-text search (it can be a member name). */
function auditFilters(f: ReturnType<typeof parseFilters>) {
    const { search, ...rest } = f;
    return { ...rest, searchApplied: Boolean(search) };
}
