/**
 * Map-matching (road-snapping) for Live Employee Tracking — see
 * attendance-hr/plan-road-snapped-tracking-map.md. Isolates the
 * Google Roads API request/response shape so swapping providers later only
 * touches this file.
 */

export type RawTrackPoint = { latitude: number; longitude: number };
export type SnappedPoint = { latitude: number; longitude: number };

/** Google's Snap To Roads endpoint accepts at most 100 points per request. */
const MAX_POINTS_PER_REQUEST = 100;

type GoogleSnapToRoadsResponse = {
    snappedPoints?: { location: { latitude: number; longitude: number }; originalIndex?: number; placeId: string }[];
    error?: { message: string };
};

async function snapChunk(points: RawTrackPoint[], apiKey: string): Promise<SnappedPoint[]> {
    const path = points.map((p) => `${p.latitude},${p.longitude}`).join('|');
    const url = `https://roads.googleapis.com/v1/snapToRoads?path=${encodeURIComponent(path)}&interpolate=true&key=${apiKey}`;

    const res = await fetch(url);
    const data: GoogleSnapToRoadsResponse = await res.json();

    if (!res.ok || data.error) {
        throw new Error(data.error?.message || `Google Roads API request failed (${res.status})`);
    }

    return (data.snappedPoints ?? []).map((p) => ({ latitude: p.location.latitude, longitude: p.location.longitude }));
}

/**
 * Snaps an ordered sequence of raw GPS points onto the road network.
 * Batches into <=100-point chunks (Google's per-request limit) and
 * concatenates the results in order — chunk boundaries may have a small
 * seam (the interpolated smoothing resets at each chunk), an accepted
 * simplification rather than a paid-per-request cost blowup from calling
 * once per point.
 *
 * Throws if GOOGLE_MAPS_API_KEY is not configured or the request fails —
 * callers (the route-snapped API route) should catch and fall back to the
 * raw straight-line path rather than blocking the map.
 */
export async function snapPointsToRoads(points: RawTrackPoint[]): Promise<SnappedPoint[]> {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
        throw new Error('GOOGLE_MAPS_API_KEY is not configured');
    }
    if (points.length < 2) {
        return points;
    }

    const chunks: RawTrackPoint[][] = [];
    for (let i = 0; i < points.length; i += MAX_POINTS_PER_REQUEST) {
        chunks.push(points.slice(i, i + MAX_POINTS_PER_REQUEST));
    }

    const snappedChunks = await Promise.all(chunks.map((chunk) => snapChunk(chunk, apiKey)));
    return snappedChunks.flat();
}
