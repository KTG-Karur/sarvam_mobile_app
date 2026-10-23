import { z } from 'zod';

const LOCATION_REQUIRED = 'Location is required to revert — allow location access or pick the spot on the map.';

/** Spread into any revert route's Zod object: the reverting user's location is mandatory. */
export const revertLocationFields = {
    latitude: z
        .number({ required_error: LOCATION_REQUIRED, invalid_type_error: LOCATION_REQUIRED })
        .min(-90, 'Invalid latitude')
        .max(90, 'Invalid latitude'),
    longitude: z
        .number({ required_error: LOCATION_REQUIRED, invalid_type_error: LOCATION_REQUIRED })
        .min(-180, 'Invalid longitude')
        .max(180, 'Invalid longitude'),
};

export type RevertLocation = { latitude: number; longitude: number };

/** Columns to spread into the `data` of the row(s) being marked reverted. */
export function revertLocationColumns(loc: RevertLocation) {
    return { revertLatitude: loc.latitude, revertLongitude: loc.longitude };
}

/** Same, for routes that don't use Zod objects (plain `body` destructuring). */
export function parseRevertLocation(body: unknown): { location: RevertLocation } | { error: string } {
    const parsed = z.object(revertLocationFields).safeParse(body ?? {});
    if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? LOCATION_REQUIRED };
    return { location: { latitude: parsed.data.latitude, longitude: parsed.data.longitude } };
}

/** Shape the history GETs return per row. */
export function toRevertLocationDto(row: { revertLatitude: number | null; revertLongitude: number | null }) {
    return row.revertLatitude != null && row.revertLongitude != null
        ? { latitude: row.revertLatitude, longitude: row.revertLongitude }
        : null;
}
