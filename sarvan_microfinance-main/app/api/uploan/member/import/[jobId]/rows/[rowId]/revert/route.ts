import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { isWithinRevertWindow, findRowsWithPostImportActivity } from '@/app/lib/uploan-import-revert-gate';

export async function OPTIONS() {
    return handleCorsPreflight();
}

const bodySchema = z.object({
    reason: z.string().trim().min(1, 'A reason is required to revert a member'),
});

/**
 * POST /api/uploan/member/import/[jobId]/rows/[rowId]/revert
 * Same-day revert of ONE member (row) from a completed uploan import, independent of the
 * whole-job revert (POST .../import/[jobId]/revert). Undoes just this row's
 * Client/Loan/schedule/transactions/gold/co-applicant and leaves the job COMPLETED so its
 * remaining members can still be reverted one-by-one or all at once later.
 *
 * Only the row status is flipped to REVERT_PENDING here — the shared background worker
 * (uploan-import-worker.ts) already drains REVERT_PENDING rows individually via
 * revertSingleUploanRow(); its finalizeRevertJobIfComplete() is a no-op while the job is
 * still COMPLETED (not REVERTING). Poll GET .../import/status?jobId= for progress.
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ jobId: string; rowId: string }> }
) {
    return withRole(['ADMIN'], async (req, user) => {
        try {
            const { jobId, rowId } = await params;
            const { reason } = bodySchema.parse(await req.json().catch(() => ({})));

            const job = await prisma.uploanImportJob.findUnique({ where: { id: jobId } });
            if (!job) return errorResponse('Import job not found', 404);
            if (job.status !== 'COMPLETED') {
                return errorResponse(
                    `Members can only be reverted while the job is COMPLETED — its status is ${job.status}`,
                    400
                );
            }
            if (!job.completedAt || !isWithinRevertWindow(job.completedAt)) {
                return errorResponse('This import can only be reverted within 7 days of completing', 400);
            }

            const row = await prisma.uploanImportJobRow.findUnique({ where: { id: rowId } });
            if (!row || row.jobId !== jobId) return errorResponse('Import row not found for this job', 404);
            if (row.status !== 'CREATED') {
                return errorResponse(
                    `This member cannot be reverted — its status is ${row.status}, not CREATED`,
                    400
                );
            }

            const unsafeLoanIds = await findRowsWithPostImportActivity([{ loanId: row.loanId }]);
            if (row.loanId && unsafeLoanIds.has(row.loanId)) {
                return errorResponse(
                    "This member's loan has received real activity since import and cannot be safely reverted",
                    400
                );
            }

            await prisma.uploanImportJobRow.update({
                where: { id: row.id },
                data: {
                    status: 'REVERT_PENDING',
                    revertReason: reason,
                    revertedAt: new Date(),
                    revertedById: user.userId,
                },
            });

            return successResponse({ jobId, rowId: row.id }, 'Member revert started');
        } catch (error) {
            if (error instanceof z.ZodError) return errorResponse(error.errors[0].message, 400);
            console.error('[uploan import row/revert] Error:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to start revert', 500);
        }
    })(request);
}
