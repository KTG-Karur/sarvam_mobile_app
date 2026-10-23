import { prisma } from '@/app/lib/db';
import { resolveAndCreateTrackingEvent, type PunchTrackingEventParams } from '@/app/lib/hr-tracking';

/**
 * In-process background worker that retries creating the EmployeeTrackingEvent
 * row for a punch (see resolveAndCreateTrackingEvent in hr-tracking.ts) when
 * the initial attempt at punch time couldn't resolve GPS coordinates. Started
 * once (from repo-root instrumentation.ts) on a persistent `next start`
 * process — same pattern as the other in-process workers
 * (app/lib/reports/report-request-worker.ts, app/lib/auto-checkout-worker.ts).
 *
 * Unlike a sweep worker that diffs the whole Attendance/EmployeeTrackingEvent
 * tables every tick, this is queue-driven: recordPunchTrackingEvent enqueues a
 * punch only when its first attempt actually failed, and an empty queue costs
 * zero DB queries per tick — load scales with failures, not with total punch
 * volume.
 */

type QueuedPunch = PunchTrackingEventParams & { attendanceId: string; expiresAt: number };

const POLL_INTERVAL_MS = 30_000;
const RETRY_WINDOW_MS = 15 * 60 * 1000;

const queue = new Map<string, QueuedPunch>();

function queueKey(attendanceId: string, eventType: 'PUNCH_IN' | 'PUNCH_OUT'): string {
    return `${attendanceId}:${eventType}`;
}

/**
 * Called from the punch routes when the inline attempt didn't create the
 * tracking event. No-ops if the caller didn't have an attendanceId (the
 * queue keys entries by it) — e.g. call sites that don't thread it through
 * simply don't get retry coverage, same as today's best-effort behavior.
 */
export function enqueuePunchRetry(params: PunchTrackingEventParams): void {
    if (!params.attendanceId) return;
    const key = queueKey(params.attendanceId, params.eventType);
    if (queue.has(key)) return; // already queued, idempotent
    queue.set(key, { ...params, attendanceId: params.attendanceId, expiresAt: params.capturedAt.getTime() + RETRY_WINDOW_MS });
}

let started = false;

export function startPunchTrackingRetryWorker(): void {
    // Guards against Next.js dev-mode HMR calling register() again.
    if (started) return;
    started = true;

    recoverStuckPunches()
        .catch((err) => console.error('[PunchTrackingRetryWorker] Boot recovery failed:', err))
        .finally(() => {
            setInterval(() => {
                tick().catch((err) => console.error('[PunchTrackingRetryWorker] Tick failed:', err));
            }, POLL_INTERVAL_MS);
        });
}

/**
 * One-time query on startup — re-enqueues any punch from the last 15 minutes
 * that's still missing its tracking event, so a restart/redeploy doesn't lose
 * whatever was sitting in the in-memory queue at the time.
 */
async function recoverStuckPunches(): Promise<void> {
    const since = new Date(Date.now() - RETRY_WINDOW_MS);
    const recentAttendance = await prisma.attendance.findMany({
        where: {
            OR: [
                { checkIn: { gte: since } },
                { checkOut: { gte: since } },
            ],
        },
        select: {
            id: true, userId: true, branchId: true,
            checkIn: true, checkInLatitude: true, checkInLongitude: true,
            checkOut: true, checkOutLatitude: true, checkOutLongitude: true,
        },
    });
    if (recentAttendance.length === 0) return;

    // Existence check is keyed by (employeeId, eventType, capturedAt) — NOT by
    // attendanceId — because attendanceId is only populated by call sites that
    // thread it through (currently just face/verify/route.ts). A punch made via
    // device-biometric/route.ts (never updated to pass attendanceId) can still
    // have a real EmployeeTrackingEvent row with attendanceId left null; keying
    // this check on attendanceId alone would call that event "missing" and
    // enqueue a duplicate. capturedAt is reliably identical to
    // Attendance.checkIn/checkOut — both come from the same `now` in the same
    // request — so (employeeId, eventType, capturedAt) reliably identifies "this
    // punch already has an event" regardless of which route created it.
    const employeeIds = recentAttendance.map((a) => a.userId);
    const existingEvents = await prisma.employeeTrackingEvent.findMany({
        where: { employeeId: { in: employeeIds }, eventType: { in: ['PUNCH_IN', 'PUNCH_OUT'] }, capturedAt: { gte: since } },
        select: { employeeId: true, eventType: true, capturedAt: true },
    });
    const existingKeys = new Set(
        existingEvents.map((e) => `${e.employeeId}:${e.eventType}:${e.capturedAt.getTime()}`),
    );

    let recovered = 0;
    for (const a of recentAttendance) {
        if (a.checkIn && a.checkIn >= since && !existingKeys.has(`${a.userId}:PUNCH_IN:${a.checkIn.getTime()}`)) {
            enqueuePunchRetry({
                employeeId: a.userId, eventType: 'PUNCH_IN',
                latitude: a.checkInLatitude, longitude: a.checkInLongitude,
                branchId: a.branchId, capturedAt: a.checkIn, attendanceId: a.id,
                logPrefix: '[PunchTrackingRetryWorker:boot]',
            });
            recovered++;
        }
        if (a.checkOut && a.checkOut >= since && !existingKeys.has(`${a.userId}:PUNCH_OUT:${a.checkOut.getTime()}`)) {
            enqueuePunchRetry({
                employeeId: a.userId, eventType: 'PUNCH_OUT',
                latitude: a.checkOutLatitude, longitude: a.checkOutLongitude,
                branchId: a.branchId, capturedAt: a.checkOut, attendanceId: a.id,
                logPrefix: '[PunchTrackingRetryWorker:boot]',
            });
            recovered++;
        }
    }
    if (recovered > 0) {
        console.log(`[PunchTrackingRetryWorker] Boot recovery re-queued ${recovered} punch(es) still missing a tracking event.`);
    }
}

async function tick(): Promise<void> {
    if (queue.size === 0) return;

    const now = Date.now();
    for (const [key, item] of queue) {
        if (now > item.expiresAt) {
            console.warn(`[PunchTrackingRetryWorker] Giving up on ${key} after ${RETRY_WINDOW_MS / 60000}min — no GPS ever resolved.`);
            queue.delete(key);
            continue;
        }
        try {
            const created = await resolveAndCreateTrackingEvent(item);
            if (created) queue.delete(key);
        } catch (err) {
            console.error(`[PunchTrackingRetryWorker] Retry failed for ${key}:`, err);
        }
    }
}
