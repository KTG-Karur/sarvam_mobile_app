import { prisma } from '@/app/lib/db';
import { isIdle, isMoving, travelledKm } from '@/app/lib/location-movement';

/**
 * Live Employee Tracking (HR Phase 7) derivation helpers.
 *
 * Travelled KM and live status are deliberately NOT stored — they're computed
 * at query time from the raw EmployeeLocationPing sequence, the same way
 * location-utils.ts's haversineDistance is already used for one-shot distance
 * checks elsewhere (household visit, client enrollment) — here just summed
 * over a sequence instead of a single pair.
 */

export type TrackingPing = {
    latitude: number;
    longitude: number;
    capturedAt: Date;
    activityType: 'PUNCH_IN' | 'PUNCH_OUT' | 'CLIENT_VISIT' | 'EN_ROUTE' | 'IDLE_PING' | 'COLLECTION' | 'CENTER_CREATED' | 'MEMBER_ENROLLED';
    clientId?: string | null;
    batteryPercent?: number | null;
    /** Horizontal GPS accuracy (m) reported with the fix — lets movement detection tell jitter from travel. */
    accuracyMeters?: number | null;
};

export type EmployeeLiveStatus = 'ACTIVE' | 'IDLE' | 'CLIENT_VISIT' | 'EN_ROUTE' | 'OFFLINE';

/** No ping for longer than this while still on shift => considered offline / last seen. */
const OFFLINE_AFTER_MINUTES = 30;

/**
 * Distance travelled (km). Counts only confirmed moves (farther than the GPS error, measured from the last confirmed
 * position) and ignores glitches, so a phone sitting in one building adds ~0 km instead of summing every wobble.
 * See app/lib/location-movement.ts.
 */
export function computeTravelledKm(pings: TrackingPing[]): number {
    return travelledKm(pings);
}

/**
 * Derives a live status from where the fixes actually are, not from the tag the app put on them:
 * OFFLINE (punched out / no recent ping) > CLIENT_VISIT (last point is an on-site event) > EN_ROUTE (sustained
 * movement) > IDLE (stayed in one place for IDLE_AFTER_MINUTES or more) > ACTIVE (on shift, recently arrived/working).
 */
export function deriveEmployeeStatus(pings: TrackingPing[], now: Date = new Date()): EmployeeLiveStatus {
    if (pings.length === 0) return 'OFFLINE';
    const sorted = [...pings].sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
    const last = sorted[sorted.length - 1];

    if (last.activityType === 'PUNCH_OUT') return 'OFFLINE';

    const minutesSinceLast = (now.getTime() - last.capturedAt.getTime()) / (1000 * 60);
    if (minutesSinceLast > OFFLINE_AFTER_MINUTES) return 'OFFLINE';

    // Collection / center-creation / member-enrollment points fold into the
    // same "on visit" status bucket as a CLIENT_VISIT ping — all four mean
    // "stationary, doing on-site work", no separate status string needed
    // elsewhere.
    if (
        last.activityType === 'CLIENT_VISIT' ||
        last.activityType === 'COLLECTION' ||
        last.activityType === 'CENTER_CREATED' ||
        last.activityType === 'MEMBER_ENROLLED'
    ) {
        return 'CLIENT_VISIT';
    }

    if (isMoving(sorted)) return 'EN_ROUTE';
    if (isIdle(sorted)) return 'IDLE';
    return 'ACTIVE';
}

/** Distinct clientIds visited via manual CLIENT_VISIT pings (per-client granularity). */
export function countDistinctClientVisits(pings: TrackingPing[]): number {
    return new Set(pings.filter((p) => p.activityType === 'CLIENT_VISIT' && p.clientId).map((p) => p.clientId)).size;
}

/** How far (either side of the punch timestamp) a fallback background ping is still trusted for. */
const PUNCH_LOCATION_FALLBACK_WINDOW_MINUTES = 15;

export type PunchTrackingEventParams = {
    employeeId: string;
    eventType: 'PUNCH_IN' | 'PUNCH_OUT';
    latitude: number | null | undefined;
    longitude: number | null | undefined;
    batteryPercent?: number | null;
    branchId?: string | null;
    capturedAt: Date;
    /** Links the tracking event back to the Attendance row this punch wrote.
     * Optional — call sites that don't have it (e.g. device-biometric punches)
     * still get the inline best-effort attempt, just no retry-queue coverage,
     * since the queue keys entries by attendanceId. */
    attendanceId?: string;
    logPrefix: string;
};

/**
 * Resolves coordinates for a punch (its own GPS, or the nearest
 * EmployeeLocationPing within PUNCH_LOCATION_FALLBACK_WINDOW_MINUTES) and
 * creates the EmployeeTrackingEvent row that anchors it on the live
 * map/route timeline. Shared by recordPunchTrackingEvent (called inline at
 * punch time, in app/api/auth/face/verify/route.ts and
 * app/api/auth/attendance/device-biometric/route.ts) and
 * punch-tracking-retry-worker.ts (which calls this again later, once more
 * background pings may have landed) — both need the exact same resolution
 * logic. Deliberately never throws — the punch itself (Attendance
 * checkIn/checkOut) must never fail or roll back because of this. Returns
 * true if the event was created, false if coordinates still couldn't be
 * resolved (caller decides whether to queue a retry).
 */
export async function resolveAndCreateTrackingEvent(params: PunchTrackingEventParams): Promise<boolean> {
    const { employeeId, eventType, batteryPercent, branchId, capturedAt, attendanceId, logPrefix } = params;
    let { latitude, longitude } = params;

    if (latitude == null || longitude == null) {
        const windowMs = PUNCH_LOCATION_FALLBACK_WINDOW_MINUTES * 60 * 1000;
        const [before, after] = await Promise.all([
            prisma.employeeLocationPing.findFirst({
                where: { employeeId, capturedAt: { lte: capturedAt, gte: new Date(capturedAt.getTime() - windowMs) } },
                orderBy: { capturedAt: 'desc' },
                select: { latitude: true, longitude: true, capturedAt: true },
            }),
            prisma.employeeLocationPing.findFirst({
                where: { employeeId, capturedAt: { gte: capturedAt, lte: new Date(capturedAt.getTime() + windowMs) } },
                orderBy: { capturedAt: 'asc' },
                select: { latitude: true, longitude: true, capturedAt: true },
            }),
        ]);
        const beforeDiff = before ? Math.abs(capturedAt.getTime() - before.capturedAt.getTime()) : Infinity;
        const afterDiff = after ? Math.abs(after.capturedAt.getTime() - capturedAt.getTime()) : Infinity;
        const nearest = beforeDiff <= afterDiff ? before : after;
        if (!nearest) {
            console.warn(`${logPrefix} No GPS on punch and no nearby ping within ${PUNCH_LOCATION_FALLBACK_WINDOW_MINUTES}min — tracking event not yet created for employee ${employeeId} (attendance ${attendanceId}).`);
            return false;
        }
        latitude = nearest.latitude;
        longitude = nearest.longitude;
    }

    const data = { employeeId, latitude, longitude, batteryPercent, eventType, branchId, capturedAt, attendanceId };
    try {
        await prisma.employeeTrackingEvent.create({ data });
        return true;
    } catch (err) {
        try {
            await prisma.employeeTrackingEvent.create({ data }); // one retry for a transient blip
            return true;
        } catch (retryErr) {
            console.error(`${logPrefix} Failed to record tracking event after retry:`, retryErr);
            return false;
        }
    }
}

/**
 * Alias kept for the punch routes' call sites — identical to
 * resolveAndCreateTrackingEvent. Callers use the returned boolean to decide
 * whether to enqueue a retry via enqueuePunchRetry in
 * punch-tracking-retry-worker.ts.
 */
export async function recordPunchTrackingEvent(params: PunchTrackingEventParams): Promise<boolean> {
    return resolveAndCreateTrackingEvent(params);
}
