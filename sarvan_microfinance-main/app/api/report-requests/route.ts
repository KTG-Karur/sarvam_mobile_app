import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuth, handleCorsPreflight, errorResponse, successResponse } from '@/app/lib/api-utils';
import type { JWTPayload } from '@/app/lib/auth';
import { prisma } from '@/app/lib/prisma';
import { getUserContext } from '@/app/lib/permissions/guards';
import { checkReportPermission } from '@/app/lib/permissions/engine';
import { getReportEntry, isQueueCapable } from '@/app/lib/reports/report-registry';
import { getPermittedBranchIds } from '@/app/lib/permissions/branch-scope';
import { isHeadOfficeBranch } from '@/app/lib/head-office-branch';
import { generateReportRequestId } from '@/app/lib/reports/report-request-id';
import { getUtcBoundsForBranchCalendarDay } from '@/app/lib/branch-lock';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const createSchema = z.object({
    reportSlug: z.string().min(1),
    fileFormat: z.enum(['EXCEL', 'PDF', 'CSV', 'WORD']),
    fromDate: z.string().optional().nullable(),
    toDate: z.string().optional().nullable(),
    branchIds: z.union([z.array(z.string()), z.literal('ALL')]).optional(),
    filters: z.record(z.string(), z.string()).optional().nullable(),
    force: z.boolean().optional(),
});

/** Order-independent deep-equal for the small flat filter bags each report defines. */
function filtersEqual(a: Record<string, string> | null, b: Record<string, string> | null): boolean {
    const an = a ?? {};
    const bn = b ?? {};
    const aKeys = Object.keys(an).sort();
    const bKeys = Object.keys(bn).sort();
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((k, i) => k === bKeys[i] && an[k] === bn[k]);
}

const MAX_BRANCH_LABEL_ITEMS = 10;

async function resolveBranchSelection(
    user: JWTPayload,
    requested: string[] | 'ALL' | undefined
): Promise<{ branchIds: string[]; branchLabel: string } | { error: string }> {
    const permitted = await getPermittedBranchIds(user);

    let branchIds: string[];
    if (!requested || requested === 'ALL') {
        // permitted === null means genuinely unrestricted (HO-based ADMIN) — that's
        // the only case allowed to fall through to the empty-array "unrestricted"
        // sentinel below. A non-null empty array means this user has zero assigned
        // branches; without this guard that would collapse into the same empty
        // array and the worker (report-request-worker.ts) would then read it back
        // as unrestricted/all-branches — a real data-scope leak for a user who
        // should see nothing.
        if (permitted !== null && permitted.length === 0) {
            return { error: 'You have no branches assigned — contact your administrator.' };
        }
        branchIds = permitted ?? [];
    } else {
        branchIds = permitted === null ? requested : requested.filter((id) => permitted.includes(id));
        if (branchIds.length === 0) {
            return { error: 'None of the requested branches are within your access.' };
        }
    }

    if (branchIds.length === 0) {
        return { branchIds: [], branchLabel: 'ALL' };
    }

    const branches = await prisma.branch.findMany({
        where: { id: { in: branchIds } },
        select: { id: true, name: true, code: true },
    });
    const byId = new Map(branches.map((b) => [b.id, b]));

    if (branchIds.length === 1) {
        const b = byId.get(branchIds[0]);
        return { branchIds, branchLabel: b ? `${b.code}-${b.name}` : branchIds[0] };
    }

    const codes = branchIds.map((id) => byId.get(id)?.code ?? id);
    const label =
        codes.length > MAX_BRANCH_LABEL_ITEMS
            ? `${codes.slice(0, MAX_BRANCH_LABEL_ITEMS).join(', ')}, +${codes.length - MAX_BRANCH_LABEL_ITEMS} more`
            : codes.join(', ');
    return { branchIds, branchLabel: label };
}

function sortedArraysEqual(a: string[], b: string[]): boolean {
    if (a.length !== b.length) return false;
    const sa = [...a].sort();
    const sb = [...b].sort();
    return sa.every((v, i) => v === sb[i]);
}

export async function POST(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const body = await req.json();
            const input = createSchema.parse(body);

            const entry = getReportEntry(input.reportSlug);
            if (!entry || !isQueueCapable(input.reportSlug)) {
                return errorResponse('Unknown report type', 400);
            }

            if (entry.dateMode === 'RANGE' && (!input.fromDate || !input.toDate)) {
                return errorResponse('From Date and To Date are required for this report', 400);
            }
            if (entry.dateMode === 'SINGLE' && !input.fromDate) {
                return errorResponse('A date is required for this report', 400);
            }

            const ctx = await getUserContext(req);
            if (!ctx) return errorResponse('Authentication required', 401);

            const access = checkReportPermission(ctx, input.reportSlug);
            if (!access.canExport) {
                return errorResponse('You do not have export access to this report', 403);
            }

            const branchSelection = await resolveBranchSelection(user, input.branchIds);
            if ('error' in branchSelection) {
                return errorResponse(branchSelection.error, 400);
            }
            const { branchIds, branchLabel } = branchSelection;

            const fromDate = input.fromDate ? new Date(input.fromDate) : null;
            const toDate = input.toDate ? new Date(input.toDate) : null;

            // Duplicate-request check: same report/conditions already requested by this
            // user today — ask the caller to confirm reuse instead of silently
            // re-queuing an identical export (unless they've already confirmed via `force`).
            if (!input.force) {
                const { dayStartUtc, dayEndUtc } = getUtcBoundsForBranchCalendarDay(new Date());
                const candidates = await prisma.reportRequest.findMany({
                    where: {
                        reportSlug: input.reportSlug,
                        fileFormat: input.fileFormat,
                        fromDate,
                        toDate,
                        requestedByUserId: user.userId,
                        requestedAt: { gte: dayStartUtc, lte: dayEndUtc },
                        status: { in: ['PENDING', 'PROCESSING', 'COMPLETED'] },
                    },
                    orderBy: { requestedAt: 'desc' },
                });
                const existing = candidates.find(
                    (c) => sortedArraysEqual(c.branchIds, branchIds) && filtersEqual(c.filters as Record<string, string> | null, input.filters ?? null)
                );
                if (existing) {
                    return successResponse({ duplicate: true, existingRequest: existing }, 'A matching report was already requested today');
                }
            }

            const requestId = await generateReportRequestId();
            const created = await prisma.reportRequest.create({
                data: {
                    requestId,
                    reportSlug: entry.slug,
                    reportName: entry.reportName,
                    branchIds,
                    branchLabel,
                    fromDate,
                    toDate,
                    filters: input.filters ?? undefined,
                    fileFormat: input.fileFormat,
                    status: 'PENDING',
                    requestedByUserId: user.userId,
                    requestedByBranchId: user.branchId ?? null,
                },
            });

            return successResponse({ duplicate: false, request: created }, 'Report export queued');
        } catch (error: any) {
            if (error instanceof z.ZodError) {
                return errorResponse(error.errors[0].message, 400);
            }
            console.error('[report-requests][POST] Error:', error);
            return errorResponse(error.message || 'Failed to queue report export', 500);
        }
    })(request);
}

export async function GET(request: NextRequest) {
    return withAuth(async (req, user) => {
        try {
            const { searchParams } = new URL(req.url);
            const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
            const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') ?? '25', 10)));
            const fromDateStr = searchParams.get('fromDate');
            const toDateStr = searchParams.get('toDate');

            const canSeeAll = user.role === 'ADMIN' && (!user.branchId || (await isHeadOfficeBranch(user.branchId)));

            const where: any = canSeeAll ? {} : { requestedByUserId: user.userId };
            if (fromDateStr) {
                const from = new Date(fromDateStr);
                from.setHours(0, 0, 0, 0);
                where.requestedAt = { ...(where.requestedAt ?? {}), gte: from };
            }
            if (toDateStr) {
                const to = new Date(toDateStr);
                to.setHours(23, 59, 59, 999);
                where.requestedAt = { ...(where.requestedAt ?? {}), lte: to };
            }

            const [rows, totalCount] = await Promise.all([
                prisma.reportRequest.findMany({
                    where,
                    orderBy: { requestedAt: 'desc' },
                    skip: (page - 1) * pageSize,
                    take: pageSize,
                    include: {
                        requestedByUser: { select: { firstName: true, lastName: true } },
                    },
                }),
                prisma.reportRequest.count({ where }),
            ]);

            const data = rows.map(({ requestedByUser, ...row }) => ({
                ...row,
                requestedByName: requestedByUser
                    ? `${requestedByUser.firstName} ${requestedByUser.lastName}`.trim()
                    : '-',
            }));

            return successResponse({
                data,
                totalCount,
                totalPages: Math.max(1, Math.ceil(totalCount / pageSize)),
                page,
                pageSize,
            });
        } catch (error: any) {
            console.error('[report-requests][GET] Error:', error);
            return errorResponse(error.message || 'Failed to load report requests', 500);
        }
    })(request);
}
