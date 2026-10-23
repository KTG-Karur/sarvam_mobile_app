import { prisma } from '@/app/lib/prisma';
import { downloadObject } from '@/app/lib/storage/gcs-client';
import { parseBranchWiseRepaymentWorkbook, type BranchRepaymentRow } from '@/app/lib/services/uploan-branch-repayment.service';
import { importSingleUploanRow, revertSingleUploanRow, type UploanJobRowData } from '@/app/lib/services/uploan-import-row.service';

/**
 * In-process background worker for the uploan "Member upload" bulk import queue — same
 * shape as app/lib/reports/report-request-worker.ts (started once from repo-root
 * instrumentation.ts, no separate worker process or external queue). Unlike that worker,
 * which claims one whole unit of work (a report) per tick, this one claims and processes
 * one UploanImportJobRow per row — a full branch import can be 600+ rows, each replaying
 * up to ~60 historical transactions, so a single tick drains rows back-to-back for a
 * bounded time budget instead of waiting a full poll interval between every row.
 */

const POLL_INTERVAL_MS = 2000;
/** Keep processing claimed rows back-to-back within one tick, up to this budget, rather
 *  than waiting POLL_INTERVAL_MS between every single row — then yield back to the
 *  interval so a tick can never run indefinitely on a huge backlog. */
const DRAIN_BUDGET_MS = 8000;

let started = false;
// Guards against overlapping ticks: DRAIN_BUDGET_MS (8s) can legitimately exceed
// POLL_INTERVAL_MS (2s) while draining a large backlog, and setInterval fires on a fixed
// clock regardless of whether the previous tick's promise has resolved. Without this
// guard, two (or more) drain calls could run truly concurrently, each claiming a
// different row via FOR UPDATE SKIP LOCKED (safe) but then racing each other inside
// generateLoanNumber (backup-loan.service.ts) — two rows reading the same "last loan
// number" before either commits, one succeeding and the other failing on the
// loanNumber unique constraint. Confirmed as the cause of bulk "many rows failed" import
// reports. One in-flight drain of each kind at a time closes that race at the source.
let isDrainingImport = false;
let isDrainingRevert = false;

/** Parsed once per job (a 15k-row xlsx), kept for the job's duration so 600+ per-row
 *  ticks against the same job don't each re-download + re-parse it. Freed once the job
 *  is COMPLETED. */
const repaymentCacheByJobId = new Map<string, Map<string, BranchRepaymentRow[]>>();

export function startUploanImportPoller(): void {
    // Guards against Next.js dev-mode HMR calling register() again.
    if (started) return;
    started = true;

    recoverStuckRows()
        .catch((err) => console.error('[UploanImportWorker] Boot recovery failed:', err))
        .finally(() => {
            setInterval(() => {
                if (!isDrainingImport) {
                    isDrainingImport = true;
                    drainPendingRows()
                        .catch((err) => console.error('[UploanImportWorker] Tick failed:', err))
                        .finally(() => { isDrainingImport = false; });
                }
                if (!isDrainingRevert) {
                    isDrainingRevert = true;
                    drainRevertPendingRows()
                        .catch((err) => console.error('[UploanImportWorker] Revert tick failed:', err))
                        .finally(() => { isDrainingRevert = false; });
                }
            }, POLL_INTERVAL_MS);
        });
}

/** Rows left in PROCESSING (or PROCESSING_REVERT) from a crash/redeploy get requeued —
 *  importSingleUploanRow/revertSingleUploanRow never throw (they catch internally and
 *  return FAILED/REVERT_FAILED), so a row can only be stuck here from the process itself
 *  dying mid-row; no attempt cap needed, unconditional requeue is safe. */
async function recoverStuckRows(): Promise<void> {
    const result = await prisma.uploanImportJobRow.updateMany({
        where: { status: 'PROCESSING' },
        data: { status: 'PENDING', lockedAt: null },
    });
    if (result.count > 0) {
        console.log(`[UploanImportWorker] Boot recovery requeued ${result.count} in-flight row(s).`);
    }

    const revertResult = await prisma.uploanImportJobRow.updateMany({
        where: { status: 'PROCESSING_REVERT' },
        data: { status: 'REVERT_PENDING', lockedAt: null },
    });
    if (revertResult.count > 0) {
        console.log(`[UploanImportWorker] Boot recovery requeued ${revertResult.count} in-flight revert row(s).`);
    }
}

/** Atomically claims the oldest PENDING row via `FOR UPDATE SKIP LOCKED` — safe even if
 *  a future multi-instance deployment runs this poller in more than one process. */
async function claimNextPendingRow(): Promise<{ id: string; jobId: string } | null> {
    const claimed = await prisma.$queryRaw<Array<{ id: string; jobId: string }>>`
        UPDATE uploan_import_job_rows
        SET status = 'PROCESSING', "lockedAt" = NOW()
        WHERE id = (
            SELECT id FROM uploan_import_job_rows
            WHERE status = 'PENDING'
            ORDER BY "createdAt" ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING id, "jobId";
    `;
    return claimed[0] ?? null;
}

/** Same claim shape as claimNextPendingRow, but scoped to REVERT_PENDING/PROCESSING_REVERT
 *  — a distinct status pair, so this can never compete with or interfere with the forward
 *  import claim query above. */
async function claimNextRevertPendingRow(): Promise<{ id: string; jobId: string } | null> {
    const claimed = await prisma.$queryRaw<Array<{ id: string; jobId: string }>>`
        UPDATE uploan_import_job_rows
        SET status = 'PROCESSING_REVERT', "lockedAt" = NOW()
        WHERE id = (
            SELECT id FROM uploan_import_job_rows
            WHERE status = 'REVERT_PENDING'
            ORDER BY "createdAt" ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING id, "jobId";
    `;
    return claimed[0] ?? null;
}

async function getRepaymentMapForJob(jobId: string, historyFileKey: string): Promise<Map<string, BranchRepaymentRow[]>> {
    const cached = repaymentCacheByJobId.get(jobId);
    if (cached) return cached;

    const file = await downloadObject(historyFileKey);
    const map = file ? parseBranchWiseRepaymentWorkbook(file.buffer) : new Map<string, BranchRepaymentRow[]>();
    repaymentCacheByJobId.set(jobId, map);
    return map;
}

async function finalizeJobIfComplete(jobId: string): Promise<void> {
    const remaining = await prisma.uploanImportJobRow.count({
        where: { jobId, status: { in: ['PENDING', 'PROCESSING'] } },
    });
    if (remaining > 0) return;

    // Guard against ever re-stamping completedAt (which would re-open the same-day
    // revert window) on a job that has since moved on to REVERTING/REVERTED — not
    // reachable today since a job can only have PENDING rows while still
    // PENDING/PROCESSING itself, but cheap to make explicit.
    const result = await prisma.uploanImportJob.updateMany({
        where: { id: jobId, status: { in: ['PENDING', 'PROCESSING'] } },
        data: { status: 'COMPLETED', completedAt: new Date() },
    });
    if (result.count > 0) repaymentCacheByJobId.delete(jobId);
}

async function processOneRow(claimed: { id: string; jobId: string }): Promise<void> {
    const row = await prisma.uploanImportJobRow.findUniqueOrThrow({ where: { id: claimed.id } });
    const job = await prisma.uploanImportJob.findUniqueOrThrow({ where: { id: claimed.jobId } });

    if (job.status === 'PENDING') {
        await prisma.uploanImportJob.update({ where: { id: job.id }, data: { status: 'PROCESSING' } });
    }

    try {
        const branchRepaymentByLoanId = await getRepaymentMapForJob(job.id, job.historyFileKey);
        const rowData = row.rowData as unknown as UploanJobRowData;
        const result = await importSingleUploanRow(rowData, branchRepaymentByLoanId, job.createdById);

        await prisma.uploanImportJobRow.update({
            where: { id: row.id },
            data: {
                status: result.status,
                clientId: result.clientId,
                loanNumber: result.loanNumber,
                loanId: result.loanId,
                coApplicantId: result.coApplicantId,
                errorMessage: result.reason,
                processedAt: new Date(),
                lockedAt: null,
            },
        });
    } catch (error) {
        console.error(`[UploanImportWorker] Row ${row.id} failed unexpectedly:`, error);
        await prisma.uploanImportJobRow
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
        console.error(`[UploanImportWorker] finalizeJobIfComplete failed for job ${job.id}:`, err)
    );
}

async function drainPendingRows(): Promise<void> {
    const tickStart = Date.now();

    while (Date.now() - tickStart < DRAIN_BUDGET_MS) {
        const claimed = await claimNextPendingRow();
        if (!claimed) return; // nothing pending — idle until the next tick
        await processOneRow(claimed);
    }
}

async function finalizeRevertJobIfComplete(jobId: string): Promise<void> {
    const remaining = await prisma.uploanImportJobRow.count({
        where: { jobId, status: { in: ['REVERT_PENDING', 'PROCESSING_REVERT'] } },
    });
    if (remaining > 0) return;

    // Only a whole-job revert (job === REVERTING) finalizes the job to REVERTED. A
    // per-member revert (POST .../rows/[rowId]/revert) leaves the job COMPLETED, so
    // this must be a no-op there — otherwise reverting one member would wrongly mark
    // the entire import reverted and block its remaining members from being reverted.
    await prisma.uploanImportJob.updateMany({
        where: { id: jobId, status: 'REVERTING' },
        data: { status: 'REVERTED' },
    });
}

async function processOneRevertRow(claimed: { id: string; jobId: string }): Promise<void> {
    const row = await prisma.uploanImportJobRow.findUniqueOrThrow({ where: { id: claimed.id } });

    try {
        const rowData = row.rowData as unknown as UploanJobRowData;
        const result = await revertSingleUploanRow({
            loanId: row.loanId,
            clientId: row.clientId,
            coApplicantId: row.coApplicantId,
            clientStatus: rowData.resolved?.clientStatus,
        });

        await prisma.uploanImportJobRow.update({
            where: { id: row.id },
            data: {
                status: result.status,
                errorMessage: result.reason,
                lockedAt: null,
            },
        });
    } catch (error) {
        console.error(`[UploanImportWorker] Revert of row ${row.id} failed unexpectedly:`, error);
        await prisma.uploanImportJobRow
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
        console.error(`[UploanImportWorker] finalizeRevertJobIfComplete failed for job ${claimed.jobId}:`, err)
    );
}

async function drainRevertPendingRows(): Promise<void> {
    const tickStart = Date.now();

    while (Date.now() - tickStart < DRAIN_BUDGET_MS) {
        const claimed = await claimNextRevertPendingRow();
        if (!claimed) return; // nothing pending — idle until the next tick
        await processOneRevertRow(claimed);
    }
}
