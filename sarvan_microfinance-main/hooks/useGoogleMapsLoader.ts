'use client';

import { useJsApiLoader, type Libraries } from '@react-google-maps/api';

/** Browser Maps JavaScript API key; empty = Google Maps not configured (callers fall back). */
export const GOOGLE_MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';

// Module-level constant: the loader compares options by reference and throws if
// two callers request the script differently, so every caller must share this.
const LIBRARIES: Libraries = ['places'];

/**
 * The one Google Maps script loader for the whole app (location pickers, place
 * search, live tracking). Always use this instead of calling useJsApiLoader
 * directly, so the script is requested with identical options everywhere.
 */
export function useGoogleMapsLoader() {
    return useJsApiLoader({
        id: 'google-map-script',
        googleMapsApiKey: GOOGLE_MAPS_KEY,
        libraries: LIBRARIES,
    });
}
