/**
 * Place search for the map location pickers.
 *
 * Provider:
 *  - Google Places (New) when GOOGLE_MAPS_API_KEY is set — same suggestions as
 *    Google Maps, including small villages/streets that OpenStreetMap lacks.
 *    Autocomplete returns only a placeId; coordinates come from resolvePlace()
 *    once the user picks one (same session token → billed as one session).
 *  - Photon (OpenStreetMap, free, no key) otherwise.
 */

export type GeoSearchResult = {
    id: string;
    label: string;
    /** Secondary line (district/state) — Google only. */
    secondary?: string;
    /** Null for Google results until resolved via resolvePlace(). */
    latitude: number | null;
    longitude: number | null;
    /** Google place id — present when coordinates must be resolved on pick. */
    placeId?: string;
};

export type GeoBias = { lat: number; lng: number };

const USER_AGENT = `SarvamMicrofinance/1.0 (${process.env.NEXT_PUBLIC_APP_URL || 'localhost'})`;

export function isGooglePlacesEnabled(): boolean {
    return !!process.env.GOOGLE_MAPS_API_KEY;
}

export async function searchPlaces(q: string, bias?: GeoBias, sessionToken?: string): Promise<GeoSearchResult[]> {
    return isGooglePlacesEnabled() ? searchGoogle(q, bias, sessionToken) : searchPhoton(q, bias);
}

// ── Google Places (New) ──────────────────────────────────────────────────────

type GoogleAutocompleteResponse = {
    suggestions?: {
        placePrediction?: {
            placeId: string;
            text?: { text: string };
            structuredFormat?: { mainText?: { text: string }; secondaryText?: { text: string } };
        };
    }[];
    error?: { message?: string };
};

async function searchGoogle(q: string, bias?: GeoBias, sessionToken?: string): Promise<GeoSearchResult[]> {
    const body: Record<string, unknown> = {
        input: q,
        includedRegionCodes: ['in'],
        languageCode: 'en',
        ...(sessionToken ? { sessionToken } : {}),
        // Bias (not restrict) towards the pin's current area, like Google Maps does
        ...(bias
            ? { locationBias: { circle: { center: { latitude: bias.lat, longitude: bias.lng }, radius: 50000 } } }
            : {}),
    };
    const res = await fetch('https://places.googleapis.com/v1/places:autocomplete', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY as string,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
    });
    const data: GoogleAutocompleteResponse = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `Google place search failed (${res.status})`);

    return (data.suggestions ?? [])
        .map((s) => s.placePrediction)
        .filter((p): p is NonNullable<typeof p> => !!p)
        .map((p) => ({
            id: p.placeId,
            placeId: p.placeId,
            label: p.structuredFormat?.mainText?.text || p.text?.text || '',
            secondary: p.structuredFormat?.secondaryText?.text,
            latitude: null,
            longitude: null,
        }));
}

/** Looks up coordinates for a Google placeId picked from searchPlaces(). */
export async function resolvePlace(
    placeId: string,
    sessionToken?: string,
): Promise<{ latitude: number; longitude: number; label: string }> {
    if (!isGooglePlacesEnabled()) throw new Error('Google Places is not configured');
    const url =
        `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}` +
        (sessionToken ? `?sessionToken=${encodeURIComponent(sessionToken)}` : '');
    const res = await fetch(url, {
        headers: {
            'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY as string,
            'X-Goog-FieldMask': 'location,formattedAddress',
        },
        signal: AbortSignal.timeout(8000),
    });
    const data: {
        location?: { latitude: number; longitude: number };
        formattedAddress?: string;
        error?: { message?: string };
    } = await res.json();
    if (!res.ok || !data.location) throw new Error(data.error?.message || 'Could not get place location');
    return { latitude: data.location.latitude, longitude: data.location.longitude, label: data.formattedAddress || '' };
}

// ── Photon (OpenStreetMap) fallback ──────────────────────────────────────────

type PhotonFeature = {
    properties: {
        osm_type?: string;
        osm_id?: number;
        name?: string;
        housenumber?: string;
        street?: string;
        district?: string;
        city?: string;
        county?: string;
        state?: string;
        postcode?: string;
        countrycode?: string;
    };
    geometry: { coordinates: [number, number] };
};

async function searchPhoton(q: string, bias?: GeoBias): Promise<GeoSearchResult[]> {
    // bbox roughly covers India; the countrycode filter below drops border spill-over
    const url =
        'https://photon.komoot.io/api/?limit=15&lang=en&bbox=68,6,98,37' +
        (bias ? `&lat=${bias.lat}&lon=${bias.lng}` : '') +
        `&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Location search failed (${res.status})`);

    const data: { features?: PhotonFeature[] } = await res.json();
    const seen = new Set<string>();
    const results: (GeoSearchResult & { rank: number })[] = [];
    const needle = q.trim().toLowerCase();
    for (const f of data.features ?? []) {
        const p = f.properties;
        if (p.countrycode && p.countrycode.toUpperCase() !== 'IN') continue;
        const street = [p.housenumber, p.street].filter(Boolean).join(' ');
        const parts = [p.name, street, p.district, p.city, p.county, p.state, p.postcode].filter(
            (v): v is string => !!v,
        );
        // Photon repeats values across fields (e.g. city === county) — keep first occurrence
        const label = parts.filter((v, i) => parts.indexOf(v) === i).join(', ');
        if (!label || seen.has(label)) continue;
        seen.add(label);
        // Photon is fuzzy ("Solaipuram" → "Somapuram"); put real text matches first
        const lower = label.toLowerCase();
        const rank = lower.startsWith(needle) ? 0 : lower.includes(needle) ? 1 : 2;
        results.push({
            id: `${p.osm_type ?? ''}${p.osm_id ?? results.length}`,
            label,
            latitude: f.geometry.coordinates[1],
            longitude: f.geometry.coordinates[0],
            rank,
        });
    }
    return results
        .map((r, i) => ({ r, i }))
        .sort((a, b) => a.r.rank - b.r.rank || a.i - b.i)
        .slice(0, 10)
        .map(({ r }) => ({ id: r.id, label: r.label, latitude: r.latitude, longitude: r.longitude }));
}
