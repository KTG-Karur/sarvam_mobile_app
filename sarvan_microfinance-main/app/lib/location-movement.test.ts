import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/lib/db', () => ({ prisma: {} }));

import {
    IDLE_AFTER_MINUTES,
    buildMovementTimeline,
    trackStays,
    denoiseRoute,
    isIdle,
    isMoving,
    stationarySince,
    travelledKm,
    usablePoints,
    type MovementPoint,
    type TimelineItem,
} from './location-movement';
import { computeTravelledKm, deriveEmployeeStatus, type TrackingPing } from './hr-tracking';

const T0 = new Date('2026-10-22T04:00:00.000Z').getTime();
const at = (minutes: number) => new Date(T0 + minutes * 60_000);

const METERS_PER_DEGREE = 111_195;
const HOME = { latitude: 11.6643, longitude: 78.146 };
const north = (m: number) => HOME.latitude + m / METERS_PER_DEGREE;
const east = (m: number) => HOME.longitude + m / (METERS_PER_DEGREE * Math.cos((HOME.latitude * Math.PI) / 180));

// Deterministic "random" so the tests never flake.
const rng = (seed: number) => () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
};

/** A phone standing still: every fix wanders up to `wobble` metres around HOME. */
function standingStill(count: number, everyMinutes: number, wobble: number, accuracy = 25, startMin = 0): MovementPoint[] {
    const r = rng(7);
    return Array.from({ length: count }, (_, i) => ({
        latitude: north((r() * 2 - 1) * wobble),
        longitude: east((r() * 2 - 1) * wobble),
        capturedAt: at(startMin + i * everyMinutes),
        accuracyMeters: accuracy,
    }));
}

/** Walking east at `kmh`, one fix per minute. */
function walking(minutes: number, kmh: number, startMin = 0, fromMeters = 0): MovementPoint[] {
    const metersPerMinute = (kmh * 1000) / 60;
    return Array.from({ length: minutes + 1 }, (_, i) => ({
        latitude: HOME.latitude,
        longitude: east(fromMeters + i * metersPerMinute),
        capturedAt: at(startMin + i),
        accuracyMeters: 10,
    }));
}

const asPings = (points: MovementPoint[], activityType: TrackingPing['activityType'] = 'EN_ROUTE'): TrackingPing[] =>
    points.map((p) => ({ ...p, activityType, clientId: null }));

describe('standing still indoors (GPS wobble) — the reported bug', () => {
    it('is NOT moving even though consecutive fixes are tens of metres apart', () => {
        const points = standingStill(30, 2, 40); // wanders up to 40 m, a fix every 2 minutes
        expect(isMoving(points)).toBe(false);
    });

    it('two fixes 35 m apart (the old 30 m rule called this "moving") are not movement', () => {
        const points: MovementPoint[] = [
            { ...HOME, capturedAt: at(0), accuracyMeters: 25 },
            { latitude: north(35), longitude: HOME.longitude, capturedAt: at(5), accuracyMeters: 25 },
        ];
        expect(isMoving(points)).toBe(false);
        expect(deriveEmployeeStatus(asPings(points), at(6))).not.toBe('EN_ROUTE');
    });

    it('adds (almost) no travelled distance, instead of summing every wobble', () => {
        const points = standingStill(180, 1, 45); // 3 hours, a fix every minute
        const old = points.slice(1).reduce((sum, p, i) => {
            const prev = points[i];
            const dy = (p.latitude - prev.latitude) * METERS_PER_DEGREE;
            const dx = (p.longitude - prev.longitude) * METERS_PER_DEGREE * Math.cos((HOME.latitude * Math.PI) / 180);
            return sum + Math.hypot(dx, dy);
        }, 0) / 1000;
        expect(old).toBeGreaterThan(3); // what plain summing would have reported: several km while sitting still
        expect(travelledKm(points)).toBeLessThan(0.1);
    });

    it('is ACTIVE at first, then IDLE once it has stayed put for the idle time', () => {
        const points = asPings(standingStill(40, 1, 30), 'EN_ROUTE'); // the app tagged every ping EN_ROUTE
        const early = points.filter((p) => p.capturedAt <= at(5));
        expect(deriveEmployeeStatus(early, at(5))).toBe('ACTIVE');
        const later = points.filter((p) => p.capturedAt <= at(25));
        expect(deriveEmployeeStatus(later, at(25))).toBe('IDLE');
    });

    it('ignores the app\'s own EN_ROUTE tag: a stationary phone is never "Moving"', () => {
        const status = deriveEmployeeStatus(asPings(standingStill(30, 1, 40), 'EN_ROUTE'), at(30));
        expect(status).toBe('IDLE');
    });

    it('stays idle with a worse (but still usable) accuracy of 80 m and 60 m wobble', () => {
        expect(isMoving(standingStill(20, 2, 60, 80))).toBe(false);
    });

    it('slow drift of 60 m over 20 minutes is not movement', () => {
        const points: MovementPoint[] = Array.from({ length: 21 }, (_, i) => ({
            latitude: north((i / 20) * 60), longitude: HOME.longitude, capturedAt: at(i), accuracyMeters: 15,
        }));
        expect(isMoving(points)).toBe(false);
    });
});

describe('really moving', () => {
    it('walking at 5 km/h is moving and its distance is counted', () => {
        const points = walking(10, 5);
        expect(isMoving(points)).toBe(true);
        // True distance 0.83 km; a move is only counted once two fixes confirm it, so the last step or two may be pending.
        expect(travelledKm(points)).toBeGreaterThan(0.55);
        expect(travelledKm(points)).toBeLessThan(0.9);
        expect(deriveEmployeeStatus(asPings(points, 'IDLE_PING'), at(10))).toBe('EN_ROUTE'); // whatever the app tagged
    });

    it('riding at 40 km/h is moving', () => {
        const points = walking(10, 40);
        expect(isMoving(points)).toBe(true);
        expect(travelledKm(points)).toBeGreaterThan(6);
    });

    it('a fix every 5 minutes while travelling is still recognised', () => {
        const points: MovementPoint[] = [0, 5, 10].map((m, i) => ({ latitude: HOME.latitude, longitude: east(i * 1500), capturedAt: at(m), accuracyMeters: 15 }));
        expect(isMoving(points)).toBe(true);
    });

    it('stops being "moving" a few minutes after arriving', () => {
        const trip = walking(10, 5); // ends ~833 m away at minute 10
        const arrival = trip[trip.length - 1];
        const parked: MovementPoint[] = Array.from({ length: 8 }, (_, i) => ({ ...arrival, capturedAt: at(11 + i), accuracyMeters: 15 }));
        expect(isMoving([...trip, ...parked.slice(0, 1)])).toBe(true);
        expect(isMoving([...trip, ...parked])).toBe(false);
    });

    it('moving then stopping 12 minutes becomes IDLE', () => {
        const trip = walking(10, 5);
        const arrival = trip[trip.length - 1];
        const parked: MovementPoint[] = Array.from({ length: 13 }, (_, i) => ({ latitude: arrival.latitude, longitude: arrival.longitude, capturedAt: at(11 + i), accuracyMeters: 15 }));
        const all = [...trip, ...parked];
        expect(isMoving(all)).toBe(false);
        expect(isIdle(all)).toBe(true);
        const since = stationarySince(all)!.getTime();
        expect(since).toBeGreaterThanOrEqual(at(7).getTime());
        expect(since).toBeLessThanOrEqual(at(12).getTime());
    });
});

describe('bad GPS data', () => {
    it('a 5 km glitch jump 30 seconds later is ignored: no distance, no "moving"', () => {
        const points: MovementPoint[] = [
            ...standingStill(6, 1, 10),
            { latitude: north(5000), longitude: HOME.longitude, capturedAt: new Date(T0 + 6 * 60_000 + 30_000), accuracyMeters: 10 },
            ...standingStill(4, 1, 10, 25, 7),
        ];
        expect(travelledKm(points)).toBeLessThan(0.05);
        expect(isMoving(points)).toBe(false);
    });

    it('fixes with poor accuracy (300 m) are not trusted for movement or distance', () => {
        const bad: MovementPoint[] = [
            { ...HOME, capturedAt: at(0), accuracyMeters: 300 },
            { latitude: north(800), longitude: HOME.longitude, capturedAt: at(5), accuracyMeters: 300 },
        ];
        expect(usablePoints(bad)).toHaveLength(0);
        expect(isMoving(bad)).toBe(false);
        expect(travelledKm(bad)).toBe(0);
    });

    it('a missing accuracy is treated as a normal 20 m fix', () => {
        const points: MovementPoint[] = [{ ...HOME, capturedAt: at(0) }, { latitude: north(40), longitude: HOME.longitude, capturedAt: at(5) }];
        expect(isMoving(points)).toBe(false);
        expect(trackStays(points).states.every((c) => c.state !== 'MOVED')).toBe(true);
    });

    it('points given out of order are handled chronologically', () => {
        const trip = walking(10, 5);
        expect(isMoving([...trip].reverse())).toBe(true);
    });
});

describe('deriveEmployeeStatus — non-movement rules are unchanged', () => {
    const ping = (minutes: number, activityType: TrackingPing['activityType'], extra: Partial<TrackingPing> = {}): TrackingPing => ({
        ...HOME, capturedAt: at(minutes), activityType, clientId: null, accuracyMeters: 15, ...extra,
    });

    it('no data and punched-out are OFFLINE', () => {
        expect(deriveEmployeeStatus([], at(0))).toBe('OFFLINE');
        expect(deriveEmployeeStatus([ping(0, 'PUNCH_IN'), ping(5, 'PUNCH_OUT')], at(6))).toBe('OFFLINE');
    });

    it('no ping for more than 30 minutes is OFFLINE', () => {
        expect(deriveEmployeeStatus([ping(0, 'PUNCH_IN')], at(31))).toBe('OFFLINE');
        expect(deriveEmployeeStatus([ping(0, 'PUNCH_IN')], at(29))).toBe('ACTIVE');
    });

    it('a visit / collection / enrolment as the latest point is CLIENT_VISIT', () => {
        for (const type of ['CLIENT_VISIT', 'COLLECTION', 'CENTER_CREATED', 'MEMBER_ENROLLED'] as const) {
            expect(deriveEmployeeStatus([ping(0, 'PUNCH_IN'), ping(3, type)], at(4))).toBe('CLIENT_VISIT');
        }
    });

    it('just punched in with a single point is ACTIVE', () => {
        expect(deriveEmployeeStatus([ping(0, 'PUNCH_IN')], at(1))).toBe('ACTIVE');
    });

    it('the idle threshold is respected', () => {
        const still = asPings(standingStill(30, 1, 10));
        expect(IDLE_AFTER_MINUTES).toBe(10);
        expect(deriveEmployeeStatus(still.filter((p) => p.capturedAt <= at(8)), at(8))).toBe('ACTIVE');
        expect(deriveEmployeeStatus(still.filter((p) => p.capturedAt <= at(12)), at(12))).toBe('IDLE');
    });
});

describe('computeTravelledKm (used by the tracking detail and the travel report)', () => {
    it('matches the anchor-based distance', () => {
        const trip = walking(10, 5);
        expect(computeTravelledKm(asPings(trip))).toBe(travelledKm(trip));
    });
});

describe('denoiseRoute', () => {
    it('keeps every event and the confirmed moves, drops wobble from a stationary stretch', () => {
        const still = standingStill(40, 1, 30).map((p) => ({ ...p, isEvent: false }));
        const event = { latitude: north(5), longitude: HOME.longitude, capturedAt: at(20), accuracyMeters: 10, isEvent: true };
        const route = denoiseRoute([...still, event]);
        expect(route).toContain(event);
        expect(route.length).toBeLessThanOrEqual(4); // first fix, last fix, the event (+ at most a stray move)
        expect(route.length).toBeLessThan(still.length / 5);
    });

    it('keeps a real trip intact', () => {
        const trip = walking(10, 5).map((p) => ({ ...p, isEvent: false }));
        expect(denoiseRoute(trip).length).toBeGreaterThan(5);
    });
});

describe('buildMovementTimeline', () => {
    const fmt = (ms: number) => `${Math.round(ms / 60_000)}m`;
    const item = (p: MovementPoint, label = 'EN ROUTE', isEvent = false): TimelineItem => ({ ...p, isEvent, label });

    it('a phone sitting in one place for 20 minutes is ONE "Idle" entry, never a list of "Moving"', () => {
        const items = standingStill(21, 1, 35).map((p) => item(p, 'EN ROUTE')); // the app tagged each one EN_ROUTE
        const timeline = buildMovementTimeline(items, fmt);
        expect(timeline.map((t) => t.label)).toEqual(['Idle for 20m']);
    });

    it('a walk is one "Moving" entry, not one per ping', () => {
        const timeline = buildMovementTimeline(walking(10, 5).map((p) => item(p, 'IDLE PING')), fmt);
        expect(timeline.map((t) => t.label)).toEqual(['Moving']);
    });

    it('move, stop, move shows Moving / Idle / Moving, with events in place', () => {
        const trip1 = walking(8, 5);
        const stopAt = trip1[trip1.length - 1];
        const stop: MovementPoint[] = Array.from({ length: 13 }, (_, i) => ({ ...stopAt, capturedAt: at(9 + i), accuracyMeters: 10 }));
        const trip2 = walking(8, 5, 22, 666);
        const collection = item({ ...stopAt, capturedAt: at(12), accuracyMeters: 10 }, 'Collection at Center A', true);
        const timeline = buildMovementTimeline([...trip1, ...stop, ...trip2].map((p) => item(p)).concat(collection), fmt);
        const labels = timeline.map((t) => t.label);
        expect(labels[0]).toBe('Moving');
        expect(labels).toContain('Collection at Center A');
        expect(labels.some((l) => l.startsWith('Idle for'))).toBe(true);
        expect(labels[labels.length - 1]).toBe('Moving');
        expect(labels.filter((l) => l === 'Moving').length).toBe(2);
    });

    it('a stop shorter than 5 minutes is folded into the trip', () => {
        const trip1 = walking(5, 5);
        const stopAt = trip1[trip1.length - 1];
        const shortStop: MovementPoint[] = Array.from({ length: 3 }, (_, i) => ({ ...stopAt, capturedAt: at(6 + i), accuracyMeters: 10 }));
        const trip2 = walking(5, 5, 9, 416);
        const labels = buildMovementTimeline([...trip1, ...shortStop, ...trip2].map((p) => item(p)), fmt).map((t) => t.label);
        expect(labels).toEqual(['Moving']);
    });

    it('events always appear even among jitter', () => {
        const items = [
            item({ ...HOME, capturedAt: at(0), accuracyMeters: 10 }, 'PUNCH IN', true),
            ...standingStill(10, 1, 20, 25, 1).map((p) => item(p)),
        ];
        expect(buildMovementTimeline(items, fmt)[0].label).toBe('PUNCH IN');
    });
});

describe('simulations over many random GPS patterns', () => {
    const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());
    const sitting = (seed: number, sigma: number, accuracy: number): MovementPoint[] => {
        const r = rng(seed);
        return Array.from({ length: 180 }, (_, i) => ({
            latitude: north(gauss(r) * sigma), longitude: east(gauss(r) * sigma), capturedAt: at(i), accuracyMeters: accuracy,
        }));
    };
    const trip = (seed: number, kmh: number, sigma: number, accuracy: number, everyMinutes: number): MovementPoint[] => {
        const r = rng(seed);
        const out: MovementPoint[] = [];
        for (let t = 0; t <= 20; t += everyMinutes) {
            out.push({ latitude: north(gauss(r) * sigma), longitude: east(t * ((kmh * 1000) / 60) + gauss(r) * sigma), capturedAt: at(t), accuracyMeters: accuracy });
        }
        return out;
    };

    it.each([
        ['normal indoor wobble (25 m)', 25, 25],
        ['bad indoor wobble (40 m)', 40, 55],
        ['terrible wobble (60 m)', 60, 90],
    ])('a phone sitting still for 3 hours — %s — is (almost) never "moving" and covers (almost) no distance', (_label, sigma, accuracy) => {
        let wrong = 0;
        let minutes = 0;
        let worstKm = 0;
        for (let seed = 1; seed <= 60; seed++) {
            const points = sitting(seed, sigma, accuracy);
            for (let n = 5; n <= 180; n += 3) {
                minutes++;
                if (isMoving(points.slice(0, n))) wrong++;
            }
            worstKm = Math.max(worstKm, travelledKm(points));
        }
        expect(wrong / minutes).toBeLessThan(0.005); // under 0.5% of minutes (measured: about 0.01%)
        expect(worstKm).toBeLessThan(0.5); // plain ping-to-ping summing gives several km
    });

    it.each([
        [3, 1], [4, 1], [5, 2], [10, 3], [30, 5],
    ])('a real walk / ride at %i km/h with a fix every %i min is always recognised as moving', (kmh, every) => {
        for (let seed = 1; seed <= 60; seed++) {
            expect(isMoving(trip(seed, kmh, 30, 40, every)), `seed ${seed}`).toBe(true);
        }
    });
});

