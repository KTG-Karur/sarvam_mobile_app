import { haversineDistance } from '@/app/lib/location-utils';

/**
 * Route path similarity — see attendance-hr/plan-travel-similarity-report.md.
 * Pure algorithm, no Prisma import, so it's unit-testable on its own
 * (app/lib/route-similarity.test.ts) without touching the database.
 */

export type RoutePoint = { latitude: number; longitude: number; capturedAt: Date };

export type RouteSimilarityOptions = {
    /** How close two points must be to count as "the same place". Default 100m. */
    matchDistanceMeters?: number;
    /** A run of matched points only counts as a shared segment once it reaches this length. Default 300m. */
    minSegmentMeters?: number;
    /** ...or this many matched points, whichever is stricter. Default 3. */
    minSegmentPoints?: number;
    /** Consecutive unmatched points still allowed inside an otherwise-matching run (GPS jitter tolerance). Default 2. */
    maxGapPoints?: number;
    /** How far ahead/behind the other path's current position to search for a match — keeps matching roughly
     * sequential (not a blind "anywhere in the whole day" lookup) without full path realignment. Default 25. */
    searchWindow?: number;
    /** If set, a candidate match is only valid when the two points' timestamps are also within this many
     * minutes of each other — turns "covered the same ground that day" into "covered it at the same time".
     * Default null = no temporal gate (matching is spatial-only; see sharedTimeMinutes for the reported stat). */
    maxTimeGapMinutes?: number | null;
};

const DEFAULTS: Required<RouteSimilarityOptions> = {
    matchDistanceMeters: 100,
    minSegmentMeters: 300,
    minSegmentPoints: 3,
    maxGapPoints: 2,
    searchWindow: 25,
    maxTimeGapMinutes: null,
};

export type RouteSegment = {
    /** Indices into the "from" path this segment spans. */
    fromStartIndex: number;
    fromEndIndex: number;
    distanceMeters: number;
    fromStartAt: Date;
    fromEndAt: Date;
    /** The matched range in the "to" path, for the temporal-overlap calculation. */
    toStartAt: Date;
    toEndAt: Date;
};

export type RouteSimilarityResult = {
    sharedDistanceKm: number;
    similarityPercent: number;
    totalDistanceAKm: number;
    totalDistanceBKm: number;
    sharedTimeMinutes: number;
    segmentsMatched: number;
    /** From A's perspective — useful for a future "show me the overlap on the map" drill-down. */
    segments: RouteSegment[];
};

function pathDistanceKm(path: RoutePoint[]): number {
    let meters = 0;
    for (let i = 1; i < path.length; i++) {
        meters += haversineDistance(path[i - 1].latitude, path[i - 1].longitude, path[i].latitude, path[i].longitude);
    }
    return meters / 1000;
}

/** Points within `radiusMeters` of `center` removed — see plan §"office exclusion". */
export function filterNearPoint(points: RoutePoint[], center: { latitude: number; longitude: number }, radiusMeters: number): RoutePoint[] {
    return points.filter((p) => haversineDistance(p.latitude, p.longitude, center.latitude, center.longitude) > radiusMeters);
}

type MatchedIndex = { toIndex: number } | null;

/**
 * For each point in `from`, finds the nearest point in `to` within `matchDistanceMeters`,
 * searching only a local window around the previous match — this is what keeps matching
 * "sequential" (both paths must advance together) rather than a blind nearest-anywhere
 * lookup that could wrongly link two unrelated parts of the day just because they happen
 * to pass the same spot at different times.
 */
function matchIndices(from: RoutePoint[], to: RoutePoint[], opts: Required<RouteSimilarityOptions>): MatchedIndex[] {
    const result: MatchedIndex[] = new Array(from.length).fill(null);
    let cursor = 0;
    for (let i = 0; i < from.length; i++) {
        const lo = Math.max(0, cursor - opts.searchWindow);
        const hi = Math.min(to.length - 1, cursor + opts.searchWindow);
        let bestIdx = -1;
        let bestDist = Infinity;
        for (let j = lo; j <= hi; j++) {
            const d = haversineDistance(from[i].latitude, from[i].longitude, to[j].latitude, to[j].longitude);
            if (d > opts.matchDistanceMeters) continue;
            if (opts.maxTimeGapMinutes != null) {
                const minutesApart = Math.abs(from[i].capturedAt.getTime() - to[j].capturedAt.getTime()) / 60000;
                if (minutesApart > opts.maxTimeGapMinutes) continue;
            }
            if (d < bestDist) {
                bestDist = d;
                bestIdx = j;
            }
        }
        if (bestIdx >= 0) {
            result[i] = { toIndex: bestIdx };
            cursor = bestIdx; // advance the search window forward with this match
        }
    }
    return result;
}

/** Groups matched indices into contiguous runs (tolerating small gaps), keeping only runs long enough to count. */
function buildSegments(from: RoutePoint[], to: RoutePoint[], matches: MatchedIndex[], opts: Required<RouteSimilarityOptions>): RouteSegment[] {
    const segments: RouteSegment[] = [];
    let runStart = -1;
    let lastMatchIdx = -1;
    let gapCount = 0;

    const closeRun = (endIdx: number) => {
        if (runStart === -1 || endIdx < runStart) return;
        const pointsInRun = endIdx - runStart + 1;
        const distanceMeters = ((): number => {
            let m = 0;
            for (let k = runStart + 1; k <= endIdx; k++) {
                m += haversineDistance(from[k - 1].latitude, from[k - 1].longitude, from[k].latitude, from[k].longitude);
            }
            return m;
        })();
        if (pointsInRun >= opts.minSegmentPoints && distanceMeters >= opts.minSegmentMeters) {
            const matchedToIndices = matches.slice(runStart, endIdx + 1).filter((m): m is { toIndex: number } => m !== null).map((m) => m.toIndex);
            const toTimes = matchedToIndices.map((idx) => to[idx].capturedAt.getTime());
            segments.push({
                fromStartIndex: runStart,
                fromEndIndex: endIdx,
                distanceMeters,
                fromStartAt: from[runStart].capturedAt,
                fromEndAt: from[endIdx].capturedAt,
                toStartAt: new Date(Math.min(...toTimes)),
                toEndAt: new Date(Math.max(...toTimes)),
            });
        }
        runStart = -1;
        lastMatchIdx = -1;
        gapCount = 0;
    };

    for (let i = 0; i < matches.length; i++) {
        if (matches[i]) {
            if (runStart === -1) runStart = i;
            lastMatchIdx = i;
            gapCount = 0;
        } else if (runStart !== -1) {
            gapCount++;
            if (gapCount > opts.maxGapPoints) {
                closeRun(lastMatchIdx);
            }
        }
    }
    closeRun(lastMatchIdx);
    return segments;
}

/** Sum of the intersection of [fromStartAt,fromEndAt] and [toStartAt,toEndAt] across all segments, in minutes. */
function sharedTimeMinutesFor(segments: RouteSegment[]): number {
    let ms = 0;
    for (const s of segments) {
        const start = Math.max(s.fromStartAt.getTime(), s.toStartAt.getTime());
        const end = Math.min(s.fromEndAt.getTime(), s.toEndAt.getTime());
        if (end > start) ms += end - start;
    }
    return Math.round((ms / 60000) * 10) / 10;
}

/**
 * Compares two employees' GPS paths for the same period and reports how much ground they
 * shared — see attendance-hr/plan-travel-similarity-report.md for the full design
 * rationale (segment matching, symmetry, temporal overlap definition).
 *
 * Symmetric: computeRouteSimilarity(A, B) and computeRouteSimilarity(B, A) report the same
 * sharedDistanceKm/similarityPercent (each direction is matched independently and the
 * results averaged) — which direction is passed first never changes the answer.
 */
export function computeRouteSimilarity(pathA: RoutePoint[], pathB: RoutePoint[], options?: RouteSimilarityOptions): RouteSimilarityResult {
    const opts: Required<RouteSimilarityOptions> = { ...DEFAULTS, ...options };
    const a = [...pathA].sort((x, y) => x.capturedAt.getTime() - y.capturedAt.getTime());
    const b = [...pathB].sort((x, y) => x.capturedAt.getTime() - y.capturedAt.getTime());

    const totalDistanceAKm = pathDistanceKm(a);
    const totalDistanceBKm = pathDistanceKm(b);

    const segmentsAtoB = a.length && b.length ? buildSegments(a, b, matchIndices(a, b, opts), opts) : [];
    const segmentsBtoA = a.length && b.length ? buildSegments(b, a, matchIndices(b, a, opts), opts) : [];

    const sharedAtoBKm = segmentsAtoB.reduce((sum, s) => sum + s.distanceMeters, 0) / 1000;
    const sharedBtoAKm = segmentsBtoA.reduce((sum, s) => sum + s.distanceMeters, 0) / 1000;
    // Averaged, not min/max — see plan §2 (Symmetry): min would hide a real overlap when one
    // employee's GPS sampled more sparsely than the other's; max would overstate it.
    const sharedDistanceKm = Math.round(((sharedAtoBKm + sharedBtoAKm) / 2) * 100) / 100;

    const longerKm = Math.max(totalDistanceAKm, totalDistanceBKm);
    const similarityPercent = longerKm > 0 ? Math.round((sharedDistanceKm / longerKm) * 1000) / 10 : 0;

    return {
        sharedDistanceKm,
        similarityPercent,
        totalDistanceAKm: Math.round(totalDistanceAKm * 100) / 100,
        totalDistanceBKm: Math.round(totalDistanceBKm * 100) / 100,
        sharedTimeMinutes: sharedTimeMinutesFor(segmentsAtoB),
        segmentsMatched: segmentsAtoB.length,
        segments: segmentsAtoB,
    };
}
