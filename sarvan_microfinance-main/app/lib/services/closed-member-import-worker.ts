import { prisma } from '@/app/lib/prisma';
import {
    importSingleClosedMemberRow,
    revertSingleClosedMemberRow,
    type ClosedMemberJobRowData,
} from '@/app/lib/services/closed-member-import-row.service';

/**
 * In-process background worker for the "Closed Loan Member Upload" bulk import queue —
 * same shape as app/lib/services/uploan-import-worker.ts (started once from repo-root
 * instrumentation.ts), copied as its OWN poller rather than merged into that one: that
 * worker's claim/finalize queries are hardcoded to the uploan_import_job(_rows) tables, so
 * sharing it would mean parametrizing a working, financially-critical importer's queries
 * purely to serve a second job type — not worth the risk. This importer is also simpler
 * (no Branch Wise Repayment file to cache/re-parse per job), so there's no equivalent of
 * that worker's repaymentCacheByJobId.
 */

const POLL_INTERVAL_MS = 2000;
const DRAIN_BUDGET_MS = 8000;

let started = false;
let isDrainingImport = false;
let isDrainingRevert = false;

export function startClosedMemberImportPoller(): void {
    if (started) return;
    started = true;

    recoverStuckRows()
        .catch((err) => console.error('[ClosedMemberImportWorker] Boot recovery failed:', err))
        .finally(() => {
            setInterval(() => {
                if (!isDrainingImport) {
                    isDrainingImport = true;
                    drainPendingRows()
                        .catch((err) => console.error('[ClosedMemberImportWorker] Tick failed:', err))
                        .finally(() => { isDrainingImport = false; });
                }
                if (!isDrainingRevert) {
                    isDrainingRevert = true;
                    drainRevertPendingRows()
                        .catch((err) => console.error('[ClosedMemberImportWorker] Revert tick failed:', err))
                        .finally(() => { isDrainingRevert = false; });
                }
            }, POLL_INTERVAL_MS);
        });
}

async function recoverStuckRows(): Promise<void> {
    const result = await prisma.closedMemberImportJobRow.updateMany({
        where: { status: 'PROCESSING' },
        data: { status: 'PENDING', lockedAt: null },
    });
    if (result.count > 0) {
        console.log(`[ClosedMemberImportWorker] Boot recovery requeued ${result.count} in-flight row(s).`);
    }

    const revertResult = await prisma.closedMemberImportJobRow.updateMany({
        where: { status: 'PROCESSING_REVERT' },
        data: { status: 'REVERT_PENDING', lockedAt: null },
    });
    if (revertResult.count > 0) {
        console.log(`[ClosedMemberImportWorker] Boot recovery requeued ${revertResult.count} in-flight revert row(s).`);
    }
}

async function claimNextPendingRow(): Promise<{ id: string; jobId: string } | null> {
    const claimed = await prisma.$queryRaw<Array<{ id: string; jobId: string }>>`
        UPDATE closed_member_import_job_rows
        SET status = 'PROCESSING', "lockedAt" = NOW()
        WHERE id = (
            SELECT id FROM closed_member_import_job_rows
            WHERE status = 'PENDING'
            ORDER BY "createdAt" ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING id, "jobId";
    `;
    return claimed[0] ?? null;
}

async function claimNextRevertPendingRow(): Promise<{ id: string; jobId: string } | null> {
    const claimed = await prisma.$queryRaw<Array<{ id: string; jobId: string }>>`
        UPDATE closed_member_import_job_rows
        SET status = 'PROCESSING_REVERT', "lockedAt" = NOW()
        WHERE id = (
            SELECT id FROM closed_member_import_job_rows
            WHERE status = 'REVERT_PENDING'
            ORDER BY "createdAt" ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING id, "jobId";
    `;
    return claimed[0] ?? null;
}

async function finalizeJobIfComplete(jobId: string): Promise<void> {
    const remaining = await prisma.closedMemberImportJobRow.count({
        where: { jobId, status: { in: ['PENDING', 'PROCESSING'] } },
    });
    if (remaining > 0) return;

    await prisma.closedMemberImportJob.updateMany({
        where: { id: jobId, status: { in: ['PENDING', 'PROCESSING'] } },
        data: { status: 'COMPLETED', completedAt: new Date() },
    });
}

async function processOneRow(claimed: { id: string; jobId: string }): Promise<void> {
    const row = await prisma.closedMemberImportJobRow.findUniqueOrThrow({ where: { id: claimed.id } });
    const job = await prisma.closedMemberImportJob.findUniqueOrThrow({ where: { id: claimed.jobId } });

    if (job.status === 'PENDING') {
        await prisma.closedMemberImportJob.update({ where: { id: job.id }, data: { status: 'PROCESSING' } });
    }

    try {
        const rowData = row.rowData as unknown as ClosedMemberJobRowData;
        const result = await importSingleClosedMemberRow(rowData, job.createdById);

        await prisma.closedMemberImportJobRow.update({
            where: { id: row.id },
            data: {
                status: result.status,
                clientId: result.clientId,
                loanNumber: result.loanNumber,
                loanId: result.loanId,
                coApplicantId: result.coApplicantId,
                savingsRefundRequestId: result.savingsRefundRequestId,
                goldTransactionId: result.goldTransactionId,
                errorMessage: result.reason,
                processedAt: new Date(),
                lockedAt: null,
            },
        });
    } catch (error) {
        console.error(`[ClosedMemberImportWorker] Row ${row.id} failed unexpectedly:`, error);
        await prisma.closedMemberImportJobRow
            .update({
                where: { id: row.id },
                data: {
                    status: 'FAILED',
                    errorMessage: error instanceof Error ? error.message : 'Unknown error',
                    processedAt: new Date(),
                    lockedAt: null,
                },
            })
            .catch(() => {});
    }

    await finalizeJobIfComplete(job.id).catch((err) =>
        console.error(`[ClosedMemberImportWorker] finalizeJobIfComplete failed for job ${job.id}:`, err)
    );
}

async function drainPendingRows(): Promise<void> {
    const tickStart = Date.now();

    while (Date.now() - tickStart < DRAIN_BUDGET_MS) {
        const claimed = await claimNextPendingRow();
        if (!claimed) return;
        await processOneRow(claimed);
    }
}

async function finalizeRevertJobIfComplete(jobId: string): Promise<void> {
    const remaining = await prisma.closedMemberImportJobRow.count({
        where: { jobId, status: { in: ['REVERT_PENDING', 'PROCESSING_REVERT'] } },
    });
    if (remaining > 0) return;

    // Only a whole-job revert (job === REVERTING) finalizes the job to REVERTED. A
    // per-member revert leaves the job COMPLETED so its other members stay revertable.
    await prisma.closedMemberImportJob.updateMany({
        where: { id: jobId, status: 'REVERTING' },
        data: { status: 'REVERTED' },
    });
}

async function processOneRevertRow(claimed: { id: string; jobId: string }): Promise<void> {
    const row = await prisma.closedMemberImportJobRow.findUniqueOrThrow({ where: { id: claimed.id } });

    try {
        const rowData = row.rowData as unknown as ClosedMemberJobRowData;
        const result = await revertSingleClosedMemberRow({
            loanId: row.loanId,
            clientId: row.clientId,
            coApplicantId: row.coApplicantId,
            clientStatus: rowData.resolved?.clientStatus,
        });

        await prisma.closedMemberImportJobRow.update({
            where: { id: row.id },
            data: {
                status: result.status,
                errorMessage: result.reason,
                lockedAt: null,
            },
        });
    } catch (error) {
        console.error(`[ClosedMemberImportWorker] Revert of row ${row.id} failed unexpectedly:`, error);
        await prisma.closedMemberImportJobRow
            .update({
                where: { id: row.id },
                data: {
                    status: 'REVERT_FAILED',
                    errorMessage: error instanceof Error ? error.message : 'Unknown error',
                    lockedAt: null,
                },
            })
            .catch(() => {});
    }

    await finalizeRevertJobIfComplete(claimed.jobId).catch((err) =>
        console.error(`[ClosedMemberImportWorker] finalizeRevertJobIfComplete failed for job ${claimed.jobId}:`, err)
    );
}

async function drainRevertPendingRows(): Promise<void> {
    const tickStart = Date.now();

    while (Date.now() - tickStart < DRAIN_BUDGET_MS) {
        const claimed = await claimNextRevertPendingRow();
        if (!claimed) return;
        await processOneRevertRow(claimed);
    }
}
