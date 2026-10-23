import { haversineDistance } from '@/app/lib/location-utils';

/**
 * GPS-noise-aware movement detection for Live Employee Tracking.
 *
 * A phone that is standing still still reports positions that wander by tens of metres (indoors 30-100 m is
 * normal), so "the last two pings are 30 m apart" says nothing about movement. The rules here:
 *  1. A fix is only trusted if its reported accuracy is good enough (MAX_USABLE_ACCURACY_METERS).
 *  2. WHERE someone is staying is a running AVERAGE of their fixes (a "stay"), not the latest noisy point. A move only
 *     counts when two fixes in a row are clearly outside that stay (STAY_RADIUS_METERS), so wobble never adds up.
 *  3. "Moving right now" compares the AVERAGE position of the older and the newer fixes of the last few minutes; the
 *     average cancels wobble, a real walk/ride does not.
 *  4. Impossible jumps (GPS glitches) are discarded.
 */

export type MovementPoint = {
    latitude: number;
    longitude: number;
    capturedAt: Date;
    /** Horizontal accuracy radius reported by the device, in metres. */
    accuracyMeters?: number | null;
};

/** Smallest distance between averaged positions that can be real movement. */
export const MIN_MOVE_METERS = 60;
/** Assumed accuracy when the device did not report one. */
export const DEFAULT_ACCURACY_METERS = 20;
/** Fixes reporting a larger error than this are ignored for movement / distance (they stay in the raw history). */
export const MAX_USABLE_ACCURACY_METERS = 100;
/** Above this implied speed a jump is a GPS glitch, not travel. */
export const MAX_PLAUSIBLE_SPEED_KMH = 120;
/** "Moving now" looks at the fixes of this many trailing minutes. */
export const MOVING_WINDOW_MINUTES = 6;
/** With sparse pings the last three fixes still count if they span no more than this. */
export const MOVING_MAX_SPAN_MINUTES = 20;
/** Slower than this (walking pace is about 4-5 km/h) is drift, not movement. */
export const MIN_MOVING_SPEED_KMH = 1.5;
/** A fix this far from the stay's average position is "somewhere else" (never less; more when accuracy is poor). */
export const STAY_RADIUS_METERS = 100;
/** Staying put at least this long (and not moving) is Idle. */
export const IDLE_AFTER_MINUTES = 10;
/** A stop shorter than this is not worth showing on the timeline (traffic light, quick chat). */
export const MIN_TIMELINE_IDLE_MINUTES = 5;
/** With only two fixes the gap must be this large to be called movement (jitter cannot reach it). */
const TWO_POINT_MOVE_METERS = 150;
const TWO_POINT_MAX_GAP_MINUTES = 15;

const MINUTE_MS = 60_000;

const accuracyOf = (p: MovementPoint): number => {
    const a = p.accuracyMeters;
    return a != null && Number.isFinite(a) && a >= 0 ? a : DEFAULT_ACCURACY_METERS;
};

const distanceMeters = (a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }): number =>
    haversineDistance(a.latitude, a.longitude, b.latitude, b.longitude);

const meanOf = (points: readonly MovementPoint[]) => ({
    latitude: points.reduce((s, p) => s + p.latitude, 0) / points.length,
    longitude: points.reduce((s, p) => s + p.longitude, 0) / points.length,
    time: points.reduce((s, p) => s + p.capturedAt.getTime(), 0) / points.length,
});

/** Radius a fix must exceed (from the stay's average position) to count as "somewhere else". */
const stayRadiusFor = (p: MovementPoint): number => Math.max(STAY_RADIUS_METERS, accuracyOf(p) * 2.5);

/** Chronological copy of the points that can be trusted for movement decisions. */
export function usablePoints<T extends MovementPoint>(points: readonly T[]): T[] {
    return points
        .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude) && accuracyOf(p) <= MAX_USABLE_ACCURACY_METERS)
        .sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
}

export type PointState = 'FIRST' | 'STILL' | 'MOVED' | 'OUTLIER';

export type StayTrack<T extends MovementPoint> = {
    /** Per trusted point: part of the current stay, a confirmed move, a one-off glitch, or the very first fix. */
    states: { point: T; state: PointState }[];
    /** Distance covered by confirmed moves (metres). */
    meters: number;
    /** When the stay the person is in now began (null with no trusted fix). */
    staySince: Date | null;
};

/**
 * Follows the trusted fixes through a sequence of stays and confirmed moves.
 * A fix inside the stay radius joins the stay (its average position updates). A fix outside it is only a CANDIDATE:
 * if the next fix is back inside, the candidate was a glitch; if two candidates in a row are outside, the person has
 * moved - the distance between the old and the new average position is counted and a new stay starts there.
 */
export function trackStays<T extends MovementPoint>(points: readonly T[]): StayTrack<T> {
    const usable = usablePoints(points);
    const states: { point: T; state: PointState }[] = [];
    let meters = 0;
    if (usable.length === 0) return { states, meters, staySince: null };

    let stay = { latitude: usable[0].latitude, longitude: usable[0].longitude, count: 1, since: usable[0].capturedAt, lastAt: usable[0].capturedAt };
    states.push({ point: usable[0], state: 'FIRST' });
    let pending: { point: T; index: number }[] = [];

    const markOutliers = () => {
        for (const c of pending) states[c.index].state = 'OUTLIER';
        pending = [];
    };

    for (let i = 1; i < usable.length; i++) {
        const point = usable[i];
        if (distanceMeters(stay, point) <= stayRadiusFor(point)) {
            markOutliers();
            stay.latitude = (stay.latitude * stay.count + point.latitude) / (stay.count + 1);
            stay.longitude = (stay.longitude * stay.count + point.longitude) / (stay.count + 1);
            stay.count++;
            stay.lastAt = point.capturedAt;
            states.push({ point, state: 'STILL' });
            continue;
        }
        pending.push({ point, index: states.length });
        states.push({ point, state: 'OUTLIER' }); // provisional - promoted to MOVED on confirmation
        if (pending.length < 2) continue;

        const centre = meanOf(pending.map((c) => c.point));
        const jump = distanceMeters(stay, centre);
        const hours = (pending[0].point.capturedAt.getTime() - stay.lastAt.getTime()) / 3_600_000;
        const glitch = hours > 0 && distanceMeters(stay, pending[0].point) / 1000 / hours > MAX_PLAUSIBLE_SPEED_KMH;
        if (glitch) {
            markOutliers();
            continue;
        }
        meters += jump;
        for (const c of pending) states[c.index].state = 'MOVED';
        stay = { latitude: centre.latitude, longitude: centre.longitude, count: pending.length, since: pending[0].point.capturedAt, lastAt: pending[pending.length - 1].point.capturedAt };
        pending = [];
    }
    return { states, meters, staySince: stay.since };
}

/** Distance actually travelled (km): confirmed moves only, never GPS wobble. */
export function travelledKm(points: readonly MovementPoint[]): number {
    return Math.round((trackStays(points).meters / 1000) * 100) / 100;
}

/**
 * Is the person moving right now? Compares the average position of the older half with the average of the newer half
 * of the last MOVING_WINDOW_MINUTES of trusted fixes (wobble averages out, a walk or ride does not) and requires a real
 * speed - slow drift and one-ping jumps are not movement.
 */
export function isMoving(points: readonly MovementPoint[]): boolean {
    // One-off glitches and unconfirmed single outliers are not evidence of movement either way.
    const track = trackStays(points);
    const usable = track.states.filter((s) => s.state !== 'OUTLIER').map((s) => s.point);
    if (usable.length < 2) return false;
    const latest = usable[usable.length - 1];
    const windowStart = latest.capturedAt.getTime() - MOVING_WINDOW_MINUTES * MINUTE_MS;
    // Belt and braces for very noisy fixes: the stay tracker must also have confirmed a real move recently.
    const confirmedRecently = track.states.some(
        (s) => s.state === 'MOVED' && latest.capturedAt.getTime() - s.point.capturedAt.getTime() <= 2 * MOVING_WINDOW_MINUTES * MINUTE_MS,
    );
    if (!confirmedRecently) return false;

    let window = usable.filter((p) => p.capturedAt.getTime() >= windowStart);
    if (window.length < 3) {
        // Sparse pings: fall back to the last three fixes if they are not too far apart in time.
        const lastThree = usable.slice(-3);
        window = lastThree.length === 3 && latest.capturedAt.getTime() - lastThree[0].capturedAt.getTime() <= MOVING_MAX_SPAN_MINUTES * MINUTE_MS ? lastThree : usable.slice(-2);
    }

    if (window.length === 2) {
        const [a, b] = window;
        const hours = (b.capturedAt.getTime() - a.capturedAt.getTime()) / 3_600_000;
        if (hours <= 0 || (b.capturedAt.getTime() - a.capturedAt.getTime()) > TWO_POINT_MAX_GAP_MINUTES * MINUTE_MS) return false;
        const meters = distanceMeters(a, b);
        const speed = meters / 1000 / hours;
        return meters >= TWO_POINT_MOVE_METERS && speed >= MIN_MOVING_SPEED_KMH && speed <= MAX_PLAUSIBLE_SPEED_KMH;
    }

    const half = Math.floor(window.length / 2);
    const older = meanOf(window.slice(0, half));
    const newer = meanOf(window.slice(window.length - half));
    const meters = distanceMeters(older, newer);
    const hours = (newer.time - older.time) / 3_600_000;
    if (hours <= 0) return false;
    const avgAccuracy = window.reduce((s, p) => s + accuracyOf(p), 0) / window.length;
    if (meters < Math.max(MIN_MOVE_METERS, avgAccuracy * 1.5)) return false;
    const speed = meters / 1000 / hours;
    return speed >= MIN_MOVING_SPEED_KMH && speed <= MAX_PLAUSIBLE_SPEED_KMH;
}

/** Since when has the person been in the same place (the stay they are in now)? null with no trusted fix. */
export function stationarySince(points: readonly MovementPoint[]): Date | null {
    return trackStays(points).staySince;
}

/**
 * Idle = not moving, and the stay they are in has lasted IDLE_AFTER_MINUTES or more as shown by the fixes themselves
 * (first fix of the stay to the newest fix). One lonely fix proves nothing, so it is never idle.
 */
export function isIdle(points: readonly MovementPoint[]): boolean {
    if (isMoving(points)) return false;
    const usable = usablePoints(points);
    if (usable.length < 2) return false;
    const since = stationarySince(points);
    return since !== null && usable[usable.length - 1].capturedAt.getTime() - since.getTime() >= IDLE_AFTER_MINUTES * MINUTE_MS;
}

/**
 * Route points for drawing: every discrete event, plus only the pings that are a confirmed move (and the first and
 * last fix), so a stationary phone's wobble is not scribbled onto the map. Fixes with poor accuracy are dropped.
 */
export function denoiseRoute<T extends MovementPoint & { isEvent?: boolean }>(points: readonly T[]): T[] {
    const keep = new Set<T>();
    for (const p of points) if (p.isEvent) keep.add(p);
    const { states } = trackStays(points);
    states.forEach((s, i) => {
        if (s.state === 'MOVED' || i === 0 || i === states.length - 1) keep.add(s.point);
    });
    return points.filter((p) => keep.has(p)).sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
}

export type TimelineItem = MovementPoint & { isEvent: boolean; label: string };

/**
 * Activity timeline from raw fixes. The app's own "EN_ROUTE" / "IDLE_PING" tags are NOT trusted (a phone can tag
 * every ping the same way): each ping is classified from its position, so
 *  - consecutive moving pings become one "Moving" entry,
 *  - a stay of MIN_TIMELINE_IDLE_MINUTES or more (at least three fixes) becomes "Idle for X",
 *  - shorter stops are folded into the surrounding movement.
 * Discrete events (punch, collection, visit...) always appear with their own label.
 */
export function buildMovementTimeline(items: readonly TimelineItem[], formatDuration: (ms: number) => string): { at: Date; label: string }[] {
    const sorted = [...items].sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
    const stateByItem = new Map<TimelineItem, PointState>();
    for (const s of trackStays(sorted.filter((i) => !i.isEvent)).states) stateByItem.set(s.point, s.state);

    type Entry = { at: Date; label: string; kind: 'EVENT' | 'MOVING' | 'IDLE' };
    const entries: Entry[] = [];
    let i = 0;
    while (i < sorted.length) {
        const item = sorted[i];
        if (item.isEvent) {
            entries.push({ at: item.capturedAt, label: item.label, kind: 'EVENT' });
            i++;
            continue;
        }
        const state = stateByItem.get(item);
        if (state === undefined || state === 'OUTLIER') { i++; continue; } // untrusted fix or glitch: says nothing
        const moving = state === 'MOVED';
        const run: TimelineItem[] = [item];
        let j = i + 1;
        while (j < sorted.length && !sorted[j].isEvent) {
            const next = stateByItem.get(sorted[j]);
            if (next !== undefined && next !== 'OUTLIER') {
                if ((next === 'MOVED') !== moving) break;
                run.push(sorted[j]);
            }
            j++;
        }
        if (moving) {
            entries.push({ at: item.capturedAt, label: 'Moving', kind: 'MOVING' });
        } else {
            const ms = run[run.length - 1].capturedAt.getTime() - run[0].capturedAt.getTime();
            if (run.length >= 3 && ms >= MIN_TIMELINE_IDLE_MINUTES * MINUTE_MS) entries.push({ at: item.capturedAt, label: `Idle for ${formatDuration(ms)}`, kind: 'IDLE' });
        }
        i = j;
    }
    // Folding short stops away can leave "Moving, Moving" back to back - show it once.
    return entries
        .filter((e, idx) => !(e.kind === 'MOVING' && entries[idx - 1]?.kind === 'MOVING'))
        .map(({ at, label }) => ({ at, label }));
}
