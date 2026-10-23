import { getCachedUcrfRecords, loadUcrfRecords, setCachedUcrfRecords, ucrfCacheKey } from './dataset.service';
import type { UcrfConfig, UcrfFilters } from './types';

/** Throttled so a full-portfolio calculation leaves the event loop and DB pool to the rest of the app. */
const JOB_BATCH = 100;
const JOB_PAUSE_MS = 150;
const JOB_KEEP_MS = 30 * 60_000;

export interface UcrfJobStatus {
    state: 'none' | 'running' | 'done' | 'error';
    done: number;
    total: number;
    error?: string;
}

interface Job extends UcrfJobStatus {
    finishedAt?: number;
}

// On globalThis for the same reason as the result cache (routes may be bundled separately).
const g = globalThis as unknown as { __ucrfJobs?: Map<string, Job> };
const jobs = (g.__ucrfJobs ??= new Map<string, Job>());

const snapshot = (j: Job): UcrfJobStatus => ({ state: j.state, done: j.done, total: j.total, error: j.error });

export function getUcrfJobStatus(filters: UcrfFilters, configVersion: string): UcrfJobStatus {
    const job = jobs.get(ucrfCacheKey(filters, configVersion));
    if (job) return snapshot(job);
    const cached = getCachedUcrfRecords(filters, configVersion);
    return cached ? { state: 'done', done: cached.length, total: cached.length } : { state: 'none', done: 0, total: 0 };
}

/** Starts the calculation without awaiting it. Only one job runs at a time, so this page can never stack up load. */
export function startUcrfJob(
    filters: UcrfFilters,
    config: UcrfConfig,
    configVersion: string,
): { ok: true; status: UcrfJobStatus } | { ok: false; reason: string } {
    const key = ucrfCacheKey(filters, configVersion);
    const existing = jobs.get(key);
    if (existing?.state === 'running') return { ok: true, status: snapshot(existing) };

    const cached = getCachedUcrfRecords(filters, configVersion);
    if (cached) return { ok: true, status: { state: 'done', done: cached.length, total: cached.length } };

    for (const j of jobs.values()) {
        if (j.state === 'running') return { ok: false, reason: 'Another UCRF calculation is already running. Please wait for it to finish.' };
    }
    for (const [k, j] of jobs) if (j.finishedAt && Date.now() - j.finishedAt > JOB_KEEP_MS) jobs.delete(k);

    const job: Job = { state: 'running', done: 0, total: 0 };
    jobs.set(key, job);
    void loadUcrfRecords(filters, config, {
        concurrency: 1,
        batchSize: JOB_BATCH,
        pauseMs: JOB_PAUSE_MS,
        onProgress: (done, total) => {
            job.done = done;
            job.total = total;
        },
    })
        .then((records) => {
            setCachedUcrfRecords(key, records);
            job.state = 'done';
            job.done = job.total = records.length;
        })
        .catch((error) => {
            console.error('[ucrf-export] background job failed', error instanceof Error ? error.message : error);
            job.state = 'error';
            job.error = 'The calculation failed. Please try again.';
        })
        .finally(() => {
            job.finishedAt = Date.now();
        });
    return { ok: true, status: snapshot(job) };
}
