import { NextRequest } from 'next/server';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import type { UploanJobRowData } from '@/app/lib/services/uploan-import-row.service';
import { isWithinRevertWindow, findRowsWithPostImportActivity } from '@/app/lib/uploan-import-revert-gate';

export async function OPTIONS() {
    return handleCorsPreflight();
}

export interface UploanImportJobRowView {
    /** DB UploanImportJobRow.id — target for the per-member revert endpoint. */
    id: string;
    rowId: string;
    name: string;
    mobileNumber: string;
    status: 'PENDING' | 'CREATED' | 'FAILED' | 'REVERT_PENDING' | 'REVERTED' | 'REVERT_FAILED';
    reason?: string;
    clientId?: string;
    loanNumber?: string;
    /** True only when this single member can be reverted right now (job COMPLETED + same
     *  day, row still CREATED, and its loan has no real post-import activity). */
    canRevert: boolean;
    revertReason?: string;
    revertedAt?: string;
    revertedByName?: string;
}

/**
 * GET /api/uploan/member/import/status?jobId=
 * Polling endpoint for the background import job — mirrors the "Request Report" export
 * queue's status shape (app/api/report-requests/route.ts). Returns every row every call
 * (not paginated) since a full branch tops out around ~600 rows, small enough to poll
 * whole; MemberUploanClient.tsx renders this straight into the existing Import Report
 * table, live, until the job reaches a terminal status.
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req) => {
        try {
            const { searchParams } = new URL(req.url);
            const jobId = searchParams.get('jobId');
            if (!jobId) return errorResponse('jobId is required', 400);

            const job = await prisma.uploanImportJob.findUnique({
                where: { id: jobId },
                include: { rows: { orderBy: { rowIndex: 'asc' } } },
            });
            if (!job) return errorResponse('Import job not found', 404);

            // Per-member revert eligibility — only computed while the job is inside its
            // one-week revert window; otherwise every row's canRevert is just false.
            const jobRevertable =
                job.status === 'COMPLETED' && !!job.completedAt && isWithinRevertWindow(job.completedAt);
            const unsafeLoanIds = jobRevertable
                ? await findRowsWithPostImportActivity(job.rows.map((r) => ({ loanId: r.loanId })))
                : new Set<string>();

            const reverterIds = [
                ...new Set(job.rows.map((r) => r.revertedById).filter((x): x is string => !!x)),
            ];
            const reverters = reverterIds.length
                ? await prisma.user.findMany({
                    where: { id: { in: reverterIds } },
                    select: { id: true, firstName: true, lastName: true },
                })
                : [];
            const reverterName = new Map(
                reverters.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()])
            );

            let createdCount = 0;
            let failedCount = 0;
            let pendingCount = 0;
            let revertedCount = 0;
            let revertFailedCount = 0;

            const rows: UploanImportJobRowView[] = job.rows.map((r) => {
                const data = r.rowData as unknown as UploanJobRowData;
                if (r.status === 'CREATED') createdCount++;
                else if (r.status === 'FAILED') failedCount++;
                else if (r.status === 'REVERTED') revertedCount++;
                else if (r.status === 'REVERT_FAILED') revertFailedCount++;
                else pendingCount++;

                // PROCESSING/PROCESSING_REVERT are internal claim-states (see
                // uploan-import-worker.ts) — collapsed to PENDING/REVERT_PENDING here
                // since the client only distinguishes not-done-yet / done / failed.
                const status: UploanImportJobRowView['status'] =
                    r.status === 'PROCESSING' ? 'PENDING'
                    : r.status === 'PROCESSING_REVERT' ? 'REVERT_PENDING'
                    : r.status;

                return {
                    id: r.id,
                    rowId: data?.rowId ?? r.id,
                    name: `${data?.firstName ?? ''} ${data?.lastName ?? ''}`.trim(),
                    mobileNumber: String(data?.mobileNumber ?? ''),
                    status,
                    reason: r.errorMessage ?? undefined,
                    clientId: r.clientId ?? undefined,
                    loanNumber: r.loanNumber ?? undefined,
                    canRevert:
                        jobRevertable &&
                        r.status === 'CREATED' &&
                        (!r.loanId || !unsafeLoanIds.has(r.loanId)),
                    revertReason: r.revertReason ?? undefined,
                    revertedAt: r.revertedAt ? r.revertedAt.toISOString() : undefined,
                    revertedByName: r.revertedById
                        ? reverterName.get(r.revertedById) ?? undefined
                        : undefined,
                };
            });

            return successResponse(
                {
                    jobId: job.id,
                    status: job.status,
                    totalRows: job.totalRows,
                    createdCount,
                    failedCount,
                    pendingCount,
                    revertedCount,
                    revertFailedCount,
                    errorMessage: job.errorMessage,
                    rows,
                },
                'Import job status fetched'
            );
        } catch (error) {
            console.error('[uploan import/status] Error:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to fetch import status', 500);
        }
    })(request);
}
