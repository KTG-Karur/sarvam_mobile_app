import { prisma } from '@/app/lib/prisma';
import { getReportEntry } from '@/app/lib/reports/report-registry';
import { buildReportFile } from '@/app/lib/reports/generic-file-builder';
import { uploadObject } from '@/app/lib/storage/gcs-client';
import { resolveReportExportKey } from '@/app/lib/storage/gcs-path-resolver';

/**
 * In-process background worker for the "Request Report" export queue.
 * Started once (from repo-root instrumentation.ts) on a persistent
 * `next start` process — there is no separate worker process or external
 * queue in this app. Concurrency is intentionally 1: a single claimed row is
 * processed at a time, since PDF export spins up a Puppeteer/Chromium
 * instance inside the same shared web-server process.
 */

const POLL_INTERVAL_MS = 5000;
const MAX_ATTEMPTS = 3;
/**
 * A PROCESSING row is only treated as orphaned (crash/redeploy) once its
 * lockedAt heartbeat is older than this. Every progress update refreshes
 * lockedAt, so a live export is never mistaken for a crashed one.
 */
const STALE_LOCK_MS = 15 * 60 * 1000;

// Kept on globalThis, not a module-level `let`: in `next dev` instrumentation.ts is
// recompiled on almost every code edit, which re-evaluates this module with a fresh
// `started = false`. That used to (a) run "boot recovery" against the row the still-
// running poller was mid-way through — requeueing it and bumping attemptCount until a
// long export (Member Report, ~1 min) was failed as "Exceeded retry attempts after
// repeated crashes" — and (b) stack another setInterval poller each time.
const globalForWorker = globalThis as typeof globalThis & {
    __reportRequestPollerStarted?: boolean;
    __reportRequestTickRunning?: boolean;
};

export function startReportRequestPoller(): void {
    if (globalForWorker.__reportRequestPollerStarted) return;
    globalForWorker.__reportRequestPollerStarted = true;

    setInterval(() => {
        // setInterval doesn't await — without this a 1-minute export let later ticks
        // claim and run more rows concurrently, despite the intended concurrency of 1.
        if (globalForWorker.__reportRequestTickRunning) return;
        globalForWorker.__reportRequestTickRunning = true;
        recoverStuckRequests()
            .then(() => processNextRequest())
            .catch((err) => console.error('[ReportRequestWorker] Tick failed:', err))
            .finally(() => { globalForWorker.__reportRequestTickRunning = false; });
    }, POLL_INTERVAL_MS);
}

/** Rows orphaned in PROCESSING by a crash/redeploy (stale heartbeat) get requeued, or failed out after too many attempts. */
async function recoverStuckRequests(): Promise<void> {
    const stuck = await prisma.reportRequest.findMany({
        where: { status: 'PROCESSING', OR: [{ lockedAt: null }, { lockedAt: { lt: new Date(Date.now() - STALE_LOCK_MS) } }] },
    });

    for (const row of stuck) {
        const nextAttempt = row.attemptCount + 1;
        if (nextAttempt > MAX_ATTEMPTS) {
            await prisma.reportRequest.update({
                where: { id: row.id },
                data: {
                    status: 'FAILED',
                    errorMessage: 'Exceeded retry attempts after repeated crashes',
                    attemptCount: nextAttempt,
                    lockedAt: null,
                },
            });
        } else {
            await prisma.reportRequest.update({
                where: { id: row.id },
                data: { status: 'PENDING', attemptCount: nextAttempt, lockedAt: null, progressPercent: 0 },
            });
        }
    }

    if (stuck.length > 0) {
        console.log(`[ReportRequestWorker] Recovered ${stuck.length} orphaned in-flight request(s).`);
    }
}

/**
 * Atomically claims the oldest PENDING row via `FOR UPDATE SKIP LOCKED` so a
 * future multi-instance deployment can't double-process the same request —
 * today's single-instance deployment doesn't strictly need this, but it's
 * the correct pattern regardless.
 */
async function claimNextPending(): Promise<{ id: string } | null> {
    const claimed = await prisma.$queryRaw<Array<{ id: string }>>`
        UPDATE report_requests
        SET status = 'PROCESSING', "lockedAt" = NOW(), "progressPercent" = 10
        WHERE id = (
            SELECT id FROM report_requests
            WHERE status = 'PENDING'
            ORDER BY "requestedAt" ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED
        )
        RETURNING id;
    `;
    return claimed[0] ?? null;
}

/** Errors caused by the request itself — retrying would fail identically, so fail fast. */
function isPermanentReportError(message: string): boolean {
    return /export limit|is required|Unknown filters|Unknown report slug|-row PDF export limit/i.test(message);
}

async function isCancelled(id: string): Promise<boolean> {
    const row = await prisma.reportRequest.findUnique({ where: { id }, select: { status: true } });
    return row?.status === 'CANCELLED';
}

/** `@db.Date` columns have no time-of-day/timezone component — read the stored calendar date directly, no IST conversion needed. */
function toDateOnlyString(value: Date | null): string | null {
    return value ? value.toISOString().split('T')[0] : null;
}

async function processNextRequest(): Promise<void> {
    const claimed = await claimNextPending();
    if (!claimed) return;

    const row = await prisma.reportRequest.findUniqueOrThrow({ where: { id: claimed.id } });

    try {
        const entry = getReportEntry(row.reportSlug);
        if (!entry || !entry.fetch) {
            await prisma.reportRequest.update({
                where: { id: row.id },
                data: { status: 'FAILED', errorMessage: 'Unknown report slug — registry entry removed or not queue-capable' },
            });
            return;
        }

        if (await isCancelled(row.id)) return;

        const resolvedFromDate = toDateOnlyString(row.fromDate);
        const resolvedToDate = toDateOnlyString(row.toDate);
        const filters = (row.filters as Record<string, string> | null) ?? null;

        const branchIds = row.branchIds.length > 0 ? row.branchIds : null;

        await prisma.reportRequest.update({ where: { id: row.id }, data: { progressPercent: 40, lockedAt: new Date() } });
        const data = await entry.fetch({
            fromDate: resolvedFromDate,
            toDate: resolvedToDate,
            branchIds,
            filters,
        });

        if (await isCancelled(row.id)) return;

        await prisma.reportRequest.update({ where: { id: row.id }, data: { progressPercent: 70, lockedAt: new Date() } });
        const file = await buildReportFile(row.fileFormat, row.reportName, data, {
            reportSlug: row.reportSlug,
            filters,
            branchLabel: row.branchLabel,
            fromDate: resolvedFromDate,
            toDate: resolvedToDate,
            branchIds,
        });

        await prisma.reportRequest.update({ where: { id: row.id }, data: { progressPercent: 90, lockedAt: new Date() } });
        const safeName = row.reportName.replace(/[^a-zA-Z0-9_-]/g, '_');
        const storageKey = resolveReportExportKey(row.requestId, `${safeName}.${file.extension}`);
        await uploadObject(storageKey, file.buffer, file.contentType);

        // Final checkpoint — buildReportFile (PDF/Puppeteer especially) and the
        // upload above can both take a while, long enough for a user to cancel
        // mid-flight. Without this check the row would get overwritten back to
        // COMPLETED right after they cancelled it.
        if (await isCancelled(row.id)) return;

        await prisma.reportRequest.update({
            where: { id: row.id },
            data: {
                status: 'COMPLETED',
                progressPercent: 100,
                completedAt: new Date(),
                totalCount: data.totalCount,
                storageKey,
            },
        });
    } catch (error) {
        console.error(`[ReportRequestWorker] Request ${row.requestId} failed:`, error);
        const message = error instanceof Error ? error.message : 'Unknown error';
        // A one-off failure (DB connection blip, GCS upload timeout) shouldn't make the
        // user re-request — requeue it, and only mark FAILED once attempts run out.
        const nextAttempt = row.attemptCount + 1;
        const giveUp = nextAttempt >= MAX_ATTEMPTS || isPermanentReportError(message);
        await prisma.reportRequest
            .update({
                where: { id: row.id },
                data: giveUp
                    ? { status: 'FAILED', errorMessage: message, attemptCount: nextAttempt, lockedAt: null }
                    : { status: 'PENDING', errorMessage: message, attemptCount: nextAttempt, lockedAt: null, progressPercent: 0 },
            })
            .catch(() => {});
    }
}
