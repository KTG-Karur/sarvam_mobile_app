/**
 * Location utilities for GPS distance calculation and matching
 */

/** Earth radius in meters */
const R = 6_371_000;

/**
 * Haversine formula — returns distance in metres between two GPS points.
 */
export function haversineDistance(
    lat1: number, lon1: number,
    lat2: number, lon2: number,
): number {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Default match radius in metres (configurable per branch in future) */
export const LOCATION_MATCH_RADIUS_METERS = 100;

/** Max allowed distance (metres) between a client's enrolled location and their assigned center. */
export const CENTER_MATCH_RADIUS_METERS = 1000;

/** Max allowed distance (metres) between the Member Individual house visit photo and the client's center. */
export const HOUSEHOLD_VISIT_CENTER_RADIUS_METERS = 500;

/**
 * Cap on how much GPS accuracy error we'll forgive on top of the match radius.
 * Prevents a wildly inaccurate fix (e.g. cell-tower/WiFi positioning reporting
 * 2000m accuracy) from trivially satisfying the match check.
 */
export const MAX_ACCURACY_TOLERANCE_METERS = 150;

/**
 * Accuracy-aware match check. Browser/device GPS reports its own margin of
 * error (`GeolocationCoordinates.accuracy`, in metres) alongside each fix —
 * indoors or in dense areas this is often 50-300m even with high-accuracy
 * mode on. A raw haversine comparison against a fixed radius can therefore
 * report "mismatch" for two people standing in the same spot. This forgives
 * the reported accuracy (capped) before applying the radius.
 */
export function isLocationMatch(
    distanceMeters: number,
    accuracyMeters?: number | null,
    radiusMeters = LOCATION_MATCH_RADIUS_METERS,
): boolean {
    const tolerance = accuracyMeters != null && isFinite(accuracyMeters)
        ? Math.min(Math.max(0, accuracyMeters), MAX_ACCURACY_TOLERANCE_METERS)
        : 0;
    return distanceMeters <= radiusMeters + tolerance;
}

export type LocationMatchResult = {
    distanceMeters: number;
    isMatch: boolean;
    label: string; // e.g. "12 m — Match ✓"
};

/**
 * Returns a human-readable GPS error message based on the GeolocationPositionError code.
 * Code 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT.
 */
export function gpsErrorMessage(err: GeolocationPositionError): string {
    switch (err.code) {
        case 1: // PERMISSION_DENIED
            return 'Location access was denied. Please allow location permission in your browser settings, or enter coordinates manually below.';
        case 2: // POSITION_UNAVAILABLE
            return 'Your device could not determine its location. Check GPS signal or enter coordinates manually below.';
        case 3: // TIMEOUT
            return 'Location request timed out. Move to an open area and try again, or enter coordinates manually below.';
        default:
            return `Could not get location (${err.message}). Enter coordinates manually below.`;
    }
}

export function checkLocationMatch(
    enrolledLat: number, enrolledLon: number,
    visitLat: number, visitLon: number,
    radiusMeters = LOCATION_MATCH_RADIUS_METERS,
): LocationMatchResult {
    const distanceMeters = haversineDistance(enrolledLat, enrolledLon, visitLat, visitLon);
    const isMatch = distanceMeters <= radiusMeters;
    const distLabel = distanceMeters < 1000
        ? `${Math.round(distanceMeters)} m`
        : `${(distanceMeters / 1000).toFixed(2)} km`;
    return {
        distanceMeters,
        isMatch,
        label: `${distLabel} — ${isMatch ? 'Match ✓' : 'Mismatch ✗'}`,
    };
}

export type AccuratePosition = {
    latitude: number;
    longitude: number;
    /** Radius of uncertainty in meters (95% confidence) reported by the device. */
    accuracy: number;
};

/**
 * Gets the most accurate current position the device can provide.
 *
 * A single getCurrentPosition() call often returns the first, coarse fix
 * (Wi-Fi/cell/IP based, or a cached one) — easily hundreds of meters off.
 * This instead watches the position with high accuracy and no cache, keeps
 * the best (lowest `accuracy`) reading, and resolves as soon as one is within
 * `targetAccuracyMeters`, when no better reading has arrived for `settleMs`
 * (a laptop's Wi-Fi fix never gets near 20 m, so waiting the full time only
 * delays it; this is how Google Maps settles too), or when `maxWaitMs`
 * elapses (with the best so far).
 * Rejects with the GeolocationPositionError only if no reading arrived at all.
 */
export function getAccurateCurrentPosition(
    options: {
        targetAccuracyMeters?: number;
        maxWaitMs?: number;
        /** Finish early once no better reading has arrived for this long. */
        settleMs?: number;
        onProgress?: (best: AccuratePosition) => void;
    } = {},
): Promise<AccuratePosition> {
    const { targetAccuracyMeters = 20, maxWaitMs = 20000, settleMs = 6000, onProgress } = options;

    return new Promise((resolve, reject) => {
        if (typeof navigator === 'undefined' || !navigator.geolocation) {
            reject(new Error('Geolocation is not supported by your browser.'));
            return;
        }

        let best: AccuratePosition | null = null;
        let settled = false;
        let settleTimer: ReturnType<typeof setTimeout> | undefined;

        const finish = (fn: () => void) => {
            if (settled) return;
            settled = true;
            navigator.geolocation.clearWatch(watchId);
            clearTimeout(timer);
            clearTimeout(settleTimer);
            fn();
        };

        const watchId = navigator.geolocation.watchPosition(
            (pos) => {
                const reading: AccuratePosition = {
                    latitude: pos.coords.latitude,
                    longitude: pos.coords.longitude,
                    accuracy: pos.coords.accuracy,
                };
                if (!best || reading.accuracy < best.accuracy) {
                    best = reading;
                    onProgress?.(best);
                    // Restart the settle window on every improvement
                    clearTimeout(settleTimer);
                    settleTimer = setTimeout(() => {
                        const result = best!;
                        finish(() => resolve(result));
                    }, settleMs);
                }
                if (best.accuracy <= targetAccuracyMeters) {
                    const result = best;
                    finish(() => resolve(result));
                }
            },
            (err) => {
                // Permission denied is final; other errors are fine if we already have a fix
                if (best && err.code !== 1) {
                    const result = best;
                    finish(() => resolve(result));
                } else {
                    finish(() => reject(err));
                }
            },
            { enableHighAccuracy: true, maximumAge: 0, timeout: maxWaitMs },
        );

        const timer = setTimeout(() => {
            if (best) {
                const result = best;
                finish(() => resolve(result));
            } else {
                finish(() =>
                    reject(new Error('Location request timed out. Move to an open area and try again.')),
                );
            }
        }, maxWaitMs);
    });
}
