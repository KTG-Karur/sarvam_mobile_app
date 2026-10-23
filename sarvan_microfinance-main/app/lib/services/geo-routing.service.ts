/**
 * Road (driving) distance lookup for "KM From Branch" — matches what a user
 * would see picking the same two points on Google Maps and requesting
 * driving directions, unlike a straight-line haversine estimate.
 *
 * Uses the free public OSRM demo server (no API key / billing required).
 * Falls back to straight-line distance if OSRM is unreachable or finds no
 * route, so center/branch creation is never blocked by a third-party outage.
 */

import { haversineDistance } from '@/app/lib/location-utils';
import redis from '@/app/lib/redis';

const OSRM_BASE_URL = 'https://router.project-osrm.org/route/v1/driving';

// Road network between two fixed points essentially never changes meaningfully.
const DRIVING_DISTANCE_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
// ~11m grid at the equator — GPS pins clicked near the same spot (branch/center
// creation form) land in the same bucket and reuse the cached lookup.
const COORD_PRECISION = 4;

export interface DrivingDistanceResult {
    distanceKm: number;
    source: 'osrm' | 'straight-line';
}

function roundCoord(n: number): number {
    const factor = 10 ** COORD_PRECISION;
    return Math.round(n * factor) / factor;
}

function drivingDistanceCacheKey(fromLat: number, fromLng: number, toLat: number, toLng: number): string {
    return `lookup:driving:${roundCoord(fromLat)},${roundCoord(fromLng)}:${roundCoord(toLat)},${roundCoord(toLng)}`;
}

async function fetchDrivingDistanceKm(
    fromLat: number,
    fromLng: number,
    toLat: number,
    toLng: number,
): Promise<DrivingDistanceResult> {
    try {
        // OSRM expects lng,lat (not lat,lng) coordinate order.
        const url = `${OSRM_BASE_URL}/${fromLng},${fromLat};${toLng},${toLat}?overview=false`;
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!res.ok) throw new Error(`OSRM responded with status ${res.status}`);

        const data = await res.json();
        const distanceMeters = data?.routes?.[0]?.distance;
        if (data?.code !== 'Ok' || typeof distanceMeters !== 'number') {
            throw new Error('OSRM found no drivable route between these points');
        }

        return { distanceKm: distanceMeters / 1000, source: 'osrm' };
    } catch (error) {
        console.error('Driving distance lookup failed, falling back to straight-line:', error);
        const distanceMeters = haversineDistance(fromLat, fromLng, toLat, toLng);
        return { distanceKm: distanceMeters / 1000, source: 'straight-line' };
    }
}

export async function getDrivingDistanceKm(
    fromLat: number,
    fromLng: number,
    toLat: number,
    toLng: number,
): Promise<DrivingDistanceResult> {
    const cacheKey = drivingDistanceCacheKey(fromLat, fromLng, toLat, toLng);

    try {
        const cached = await redis.get(cacheKey);
        if (cached) return JSON.parse(cached) as DrivingDistanceResult;
    } catch (err) {
        console.error('[drivingDistance] cache read failed, bypassing cache:', (err as Error).message);
    }

    const result = await fetchDrivingDistanceKm(fromLat, fromLng, toLat, toLng);

    // Only cache a real OSRM route — a straight-line result means OSRM was
    // unreachable or found no route, and caching that for 30 days would deny
    // every future caller the accurate route even after OSRM recovers.
    if (result.source === 'osrm') {
        try {
            await redis.set(cacheKey, JSON.stringify(result), 'EX', DRIVING_DISTANCE_CACHE_TTL_SECONDS);
        } catch (err) {
            console.error('[drivingDistance] cache write failed (non-fatal):', (err as Error).message);
        }
    }

    return result;
}

export interface RoutePoint {
    latitude: number;
    longitude: number;
}

export interface RoadRouteResult {
    points: RoutePoint[];
    source: 'osrm' | 'straight-line';
}

/**
 * Road-following geometry through chronological GPS points, for drawing a
 * tracked day's route on a map. Falls back to the original points (straight
 * lines) if OSRM is unreachable, so the route never disappears from the map.
 * Callers must keep `points` within OSRM's waypoint limit (100 on the demo
 * server).
 */
export async function getRoadRoute(points: RoutePoint[]): Promise<RoadRouteResult> {
    const toPoints = (geometry: unknown): RoutePoint[] =>
        Array.isArray(geometry)
            ? (geometry as [number, number][]).map(([longitude, latitude]) => ({ latitude, longitude }))
            : [];

    try {
        // OSRM expects lng,lat (not lat,lng) coordinate order.
        const coordinates = points.map((p) => `${p.longitude},${p.latitude}`).join(';');

        // `match` snaps a noisy GPS trace onto the road it was driven on, so
        // the line follows the street instead of detouring to hit every fix.
        const radiuses = points.map(() => 20).join(';');
        const matchUrl = `${OSRM_BASE_URL.replace('/route/', '/match/')}/${coordinates}?geometries=geojson&overview=full&tidy=true&radiuses=${radiuses}`;
        const matchRes = await fetch(matchUrl, { signal: AbortSignal.timeout(15000) });
        if (matchRes.ok) {
            const matchData = await matchRes.json();
            if (matchData?.code === 'Ok' && Array.isArray(matchData.matchings)) {
                const matched = matchData.matchings.flatMap((m: any) => toPoints(m?.geometry?.coordinates));
                if (matched.length >= 2) return { points: matched, source: 'osrm' };
            }
        }

        const url = `${OSRM_BASE_URL}/${coordinates}?overview=full&geometries=geojson&continue_straight=true`;
        const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (!res.ok) throw new Error(`OSRM responded with status ${res.status}`);

        const data = await res.json();
        const routed = toPoints(data?.routes?.[0]?.geometry?.coordinates);
        if (data?.code !== 'Ok' || routed.length < 2) {
            throw new Error('OSRM found no drivable route through these points');
        }

        return { points: routed, source: 'osrm' };
    } catch (error) {
        console.error('Road route lookup failed, falling back to raw GPS points:', error);
        return { points, source: 'straight-line' };
    }
}

export interface DrivingDistanceMetersResult {
    distanceMeters: number;
    source: 'osrm' | 'straight-line';
}

/** Same lookup as {@link getDrivingDistanceKm}, in metres — for server-side proximity
 *  checks (location match / center radius gates) that compare against metre thresholds. */
export async function getDrivingDistanceMeters(
    fromLat: number,
    fromLng: number,
    toLat: number,
    toLng: number,
): Promise<DrivingDistanceMetersResult> {
    const { distanceKm, source } = await getDrivingDistanceKm(fromLat, fromLng, toLat, toLng);
    return { distanceMeters: distanceKm * 1000, source };
}
