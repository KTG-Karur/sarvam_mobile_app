/**
 * Runs once when the Next.js server process starts. Used to boot the in-process
 * background workers — the "Request Report" export queue
 * (app/lib/reports/report-request-worker.ts), the uploan "Member upload" bulk-import
 * queue (app/lib/services/uploan-import-worker.ts), the "Closed Loan Member Upload"
 * bulk-import queue (app/lib/services/closed-member-import-worker.ts), and the
 * Attendance "Auto Punch-Out" worker (app/lib/auto-checkout-worker.ts), and the
 * "Punch Tracking Retry" worker (app/lib/punch-tracking-retry-worker.ts) — there is no
 * separate worker process or external queue in this app, they run alongside the web
 * server since the app is deployed as a persistent `next start` process, not serverless.
 */
export async function register() {
    if (process.env.NEXT_RUNTIME === 'nodejs') {
        const { startReportRequestPoller } = await import('@/app/lib/reports/report-request-worker');
        startReportRequestPoller();

        const { startUploanImportPoller } = await import('@/app/lib/services/uploan-import-worker');
        startUploanImportPoller();

        const { startClosedMemberImportPoller } = await import('@/app/lib/services/closed-member-import-worker');
        startClosedMemberImportPoller();

        const { startAutoCheckoutWorker } = await import('@/app/lib/auto-checkout-worker');
        startAutoCheckoutWorker();

        const { startPunchTrackingRetryWorker } = await import('@/app/lib/punch-tracking-retry-worker');
        startPunchTrackingRetryWorker();
    }
}
