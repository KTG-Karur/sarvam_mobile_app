import { describe, expect, it } from 'vitest';
import { computeRouteSimilarity, filterNearPoint, type RoutePoint } from '@/app/lib/route-similarity';

// A straight line of points ~111m apart (roughly 0.001 degrees latitude), starting at
// (lat0, lng0), one point per minute — a simple, predictable synthetic route.
function makeLine(lat0: number, lng0: number, count: number, startMinute = 0): RoutePoint[] {
    return Array.from({ length: count }, (_, i) => ({
        latitude: lat0 + i * 0.001,
        longitude: lng0,
        capturedAt: new Date(2026, 8, 20, 9, startMinute + i),
    }));
}

describe('computeRouteSimilarity', () => {
    it('reports near-100% similarity for two identical paths', () => {
        const path = makeLine(10, 78, 20);
        const r = computeRouteSimilarity(path, [...path]);
        expect(r.similarityPercent).toBeGreaterThan(95);
        expect(r.sharedDistanceKm).toBeGreaterThan(r.totalDistanceAKm * 0.95);
    });

    it('reports ~0 shared distance for two completely disjoint paths', () => {
        const a = makeLine(10, 78, 20);
        const b = makeLine(20, 88, 20); // far away, never close to `a`
        const r = computeRouteSimilarity(a, b);
        expect(r.sharedDistanceKm).toBe(0);
        expect(r.similarityPercent).toBe(0);
        expect(r.segmentsMatched).toBe(0);
    });

    it('is symmetric — swapping which path is passed first does not change the result', () => {
        const a = makeLine(10, 78, 15);
        const b = [...makeLine(10, 78, 10), ...makeLine(15, 78, 10)]; // partial overlap with `a`, then diverges
        const forward = computeRouteSimilarity(a, b);
        const backward = computeRouteSimilarity(b, a);
        expect(backward.sharedDistanceKm).toBeCloseTo(forward.sharedDistanceKm, 2);
        expect(backward.similarityPercent).toBeCloseTo(forward.similarityPercent, 1);
    });

    it('does not count an isolated coincidental proximity as a shared segment (segment matching, not blind point matching)', () => {
        // `a` and `b` share a genuine short overlap of only 2 points (< minSegmentPoints default of 3),
        // then diverge completely for the rest of the day — this must NOT be reported as shared.
        const a = [...makeLine(10, 78, 2), ...makeLine(30, 78, 10, 2)];
        const b = [...makeLine(10, 78, 2, 0), ...makeLine(40, 78, 10, 2)];
        const r = computeRouteSimilarity(a, b, { minSegmentPoints: 3, minSegmentMeters: 300 });
        expect(r.segmentsMatched).toBe(0);
        expect(r.sharedDistanceKm).toBe(0);
    });

    it('counts a genuine long overlap as a qualifying segment', () => {
        const shared = makeLine(10, 78, 10);
        const a = [...shared, ...makeLine(30, 78, 5, 10)];
        const b = [...shared.map((p) => ({ ...p })), ...makeLine(40, 78, 5, 10)];
        const r = computeRouteSimilarity(a, b);
        expect(r.segmentsMatched).toBeGreaterThanOrEqual(1);
        expect(r.sharedDistanceKm).toBeGreaterThan(0.5); // the shared 10-point line is ~1km long
    });

    it('reports shared time as the intersection of the two employees\' timestamps in the overlapping segment', () => {
        const shared = makeLine(10, 78, 10, 0); // 09:00–09:09
        const a = shared;
        const b = shared.map((p) => ({ ...p, capturedAt: new Date(p.capturedAt.getTime() + 5 * 60000) })); // same spots, 09:05–09:14
        const r = computeRouteSimilarity(a, b);
        // Overlap of [09:00,09:09] and [09:05,09:14] is [09:05,09:09] = 4 minutes.
        expect(r.sharedTimeMinutes).toBeGreaterThan(0);
        expect(r.sharedTimeMinutes).toBeLessThanOrEqual(9);
    });

    it('empty paths do not throw and report zero similarity', () => {
        const r = computeRouteSimilarity([], makeLine(10, 78, 5));
        expect(r.similarityPercent).toBe(0);
        expect(r.sharedDistanceKm).toBe(0);
    });
});

describe('filterNearPoint', () => {
    it('removes points within the radius and keeps points outside it', () => {
        const office = { latitude: 10, longitude: 78 };
        const points: RoutePoint[] = [
            { latitude: 10, longitude: 78, capturedAt: new Date() }, // at the office
            { latitude: 10.001, longitude: 78, capturedAt: new Date() }, // ~111m away
            { latitude: 10.05, longitude: 78, capturedAt: new Date() }, // far away
        ];
        const filtered = filterNearPoint(points, office, 150);
        expect(filtered.length).toBe(1);
        expect(filtered[0].latitude).toBe(10.05);
    });
});
