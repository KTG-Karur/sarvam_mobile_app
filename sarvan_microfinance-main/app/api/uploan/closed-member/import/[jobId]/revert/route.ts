import { NextRequest } from 'next/server';
import { handleCorsPreflight, errorResponse, successResponse, withRole } from '@/app/lib/api-utils';
import { prisma } from '@/app/lib/prisma';
import { isWithinRevertWindow, findClosedMemberRowsWithPostImportActivity } from '@/app/lib/closed-member-import-revert-gate';

export async function OPTIONS() {
    return handleCorsPreflight();
}

/**
 * POST /api/uploan/closed-member/import/[jobId]/revert
 * Same one-week-window, whole-job revert shape as POST /api/uploan/member/import/[jobId]/revert
 * — but a row is also excluded here if its auto-created SavingsRefundRequest/
 * GoldTransaction(GIVE) was since approved or rejected by a human (see
 * closed-member-import-revert-gate.ts), not just "has a later real transaction."
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ jobId: string }> }
) {
    return withRole(['ADMIN'], async (req, user) => {
        try {
            const { jobId } = await params;
            const body = await req.json().catch(() => ({}));
            const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
            if (!reason) return errorResponse('A reason is required to revert an import', 400);

            const job = await prisma.closedMemberImportJob.findUnique({
                where: { id: jobId },
                include: { rows: { where: { status: 'CREATED' }, select: { id: true, loanId: true } } },
            });
            if (!job) return errorResponse('Import job not found', 404);
            if (job.status !== 'COMPLETED') {
                return errorResponse(`This job cannot be reverted — its status is ${job.status}, not COMPLETED`, 400);
            }
            if (!job.completedAt || !isWithinRevertWindow(job.completedAt)) {
                return errorResponse('This import can only be reverted within 7 days of completing', 400);
            }

            const unsafeLoanIds = await findClosedMemberRowsWithPostImportActivity(
                job.rows.map((r) => ({ loanId: r.loanId }))
            );

            const safeRowIds = job.rows
                .filter((r) => !r.loanId || !unsafeLoanIds.has(r.loanId))
                .map((r) => r.id);
            const skippedRowIds = job.rows
                .filter((r) => r.loanId && unsafeLoanIds.has(r.loanId))
                .map((r) => r.id);

            if (safeRowIds.length === 0) {
                return errorResponse(
                    'Every row in this job has real activity (or an already-actioned Savings/Gold request) since import and cannot be safely reverted',
                    400
                );
            }

            await prisma.$transaction([
                prisma.closedMemberImportJobRow.updateMany({
                    where: { id: { in: safeRowIds } },
                    data: { status: 'REVERT_PENDING' },
                }),
                ...(skippedRowIds.length > 0
                    ? [
                        prisma.closedMemberImportJobRow.updateMany({
                            where: { id: { in: skippedRowIds } },
                            data: {
                                errorMessage:
                                    'Skipped — this loan has received real activity, or its Savings/Gold request was already actioned, since import — left untouched',
                            },
                        }),
                    ]
                    : []),
                prisma.closedMemberImportJob.update({
                    where: { id: job.id },
                    data: {
                        status: 'REVERTING',
                        revertReason: reason,
                        revertedAt: new Date(),
                        revertedById: user.userId,
                    },
                }),
            ]);

            return successResponse(
                { jobId: job.id, revertingCount: safeRowIds.length, skippedCount: skippedRowIds.length },
                'Revert started'
            );
        } catch (error) {
            console.error('[closed-member import/revert] Error:', error);
            return errorResponse(error instanceof Error ? error.message : 'Failed to start revert', 500);
        }
    })(request);
}
