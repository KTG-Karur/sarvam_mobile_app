import { haversineDistance } from '@/app/lib/location-utils';

/** Nominal punch-in radius around the branch. */
export const PUNCH_RADIUS_METERS = 100;
/** GPS drift we forgive on top of the radius — punch-in is allowed up to 130 m. */
export const PUNCH_RADIUS_ALLOWANCE_METERS = 30;
export const PUNCH_RADIUS_MAX_ALLOWED_METERS = PUNCH_RADIUS_METERS + PUNCH_RADIUS_ALLOWANCE_METERS;

export type PunchRadiusCode = 'LOCATION_REQUIRED' | 'OUT_OF_RADIUS';

export type PunchRadiusResult =
    | { allowed: true; distanceMeters: number | null }
    | { allowed: false; code: PunchRadiusCode; distanceMeters: number | null; message: string };

/**
 * Punch-in radius rule for an employee whose Punch Radius lock is ON.
 * - lock off, or the branch has no coordinates -> allowed (rule skipped);
 * - no device coordinates -> refused (the request's own GPS is the only source; never a stale ping);
 * - farther than PUNCH_RADIUS_MAX_ALLOWED_METERS from the branch -> refused.
 * Only called for PUNCH_IN; punch-out is never restricted.
 */
export function checkPunchRadius(params: {
    locked: boolean;
    branch: { name: string; latitude: number | null; longitude: number | null } | null;
    latitude?: number | null;
    longitude?: number | null;
}): PunchRadiusResult {
    const { locked, branch, latitude, longitude } = params;
    if (!locked) return { allowed: true, distanceMeters: null };
    if (!branch || branch.latitude == null || branch.longitude == null) {
        return { allowed: true, distanceMeters: null };
    }
    if (latitude == null || longitude == null || !isFinite(latitude) || !isFinite(longitude)) {
        return {
            allowed: false,
            code: 'LOCATION_REQUIRED',
            distanceMeters: null,
            message: 'Turn on location to punch in. Your location is required within the branch radius.',
        };
    }
    const distanceMeters = Math.round(haversineDistance(branch.latitude, branch.longitude, latitude, longitude));
    if (distanceMeters > PUNCH_RADIUS_MAX_ALLOWED_METERS) {
        return {
            allowed: false,
            code: 'OUT_OF_RADIUS',
            distanceMeters,
            message: `You are ${distanceMeters} m away from ${branch.name}. Punch in is allowed within ${PUNCH_RADIUS_METERS} m of the branch.`,
        };
    }
    return { allowed: true, distanceMeters };
}
