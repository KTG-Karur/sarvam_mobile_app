import { NextRequest } from 'next/server';
import { handleCorsPreflight, errorResponse, successResponse, withAuth } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import type { ClosedMemberJobRowData } from '@/app/lib/services/closed-member-import-row.service';
import { isWithinRevertWindow, findClosedMemberRowsWithPostImportActivity } from '@/app/lib/closed-member-import-revert-gate';

export async function OPTIONS() {
    return handleCorsPreflight();
}

export interface ClosedMemberImportJobRowView {
    /** DB ClosedMemberImportJobRow.id — target for the per-member revert endpoint. */
    id: string;
    rowId: string;
    name: string;
    mobileNumber: string;
    status: 'PENDING' | 'CREATED' | 'FAILED' | 'REVERT_PENDING' | 'REVERTED' | 'REVERT_FAILED';
    reason?: string;
    clientId?: string;
    loanNumber?: string;
    savingsRefundRequestCreated: boolean;
    goldReturnRequestCreated: boolean;
    canRevert: boolean;
    revertReason?: string;
    revertedAt?: string;
    revertedByName?: string;
}

/**
 * GET /api/uploan/closed-member/import/status?jobId=
 * Polling endpoint for the background import job — same unpaginated, collapsed-status
 * shape as GET /api/uploan/member/import/status.
 */
export async function GET(request: NextRequest) {
    return withAuth(async (req) => {
        try {
            const { searchParams } = new URL(req.url);
            const jobId = searchParams.get('jobId');
            if (!jobId) return errorResponse('jobId is required', 400);

            const job = await prisma.closedMemberImportJob.findUnique({
                where: { id: jobId },
                include: { rows: { orderBy: { rowIndex: 'asc' } } },
            });
            if (!job) return errorResponse('Import job not found', 404);

            const jobRevertable =
                job.status === 'COMPLETED' && !!job.completedAt && isWithinRevertWindow(job.completedAt);
            const unsafeLoanIds = jobRevertable
                ? await findClosedMemberRowsWithPostImportActivity(job.rows.map((r) => ({ loanId: r.loanId })))
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

            const rows: ClosedMemberImportJobRowView[] = job.rows.map((r) => {
                const data = r.rowData as unknown as ClosedMemberJobRowData;
                if (r.status === 'CREATED') createdCount++;
                else if (r.status === 'FAILED') failedCount++;
                else if (r.status === 'REVERTED') revertedCount++;
                else if (r.status === 'REVERT_FAILED') revertFailedCount++;
                else pendingCount++;

                const status: ClosedMemberImportJobRowView['status'] =
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
                    savingsRefundRequestCreated: !!r.savingsRefundRequestId,
                    goldReturnRequestCreated: !!r.goldTransactionId,
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
                    createLoan: job.createLoan,
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
            console.error('[closed-member import/status] Error:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to fetch import status', 500);
        }
    })(request);
}
