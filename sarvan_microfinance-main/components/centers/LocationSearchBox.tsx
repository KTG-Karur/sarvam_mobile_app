'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, Loader2, MapPin, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { apiClient } from '@/app/lib/api-client';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import type { GeoSearchResult } from '@/app/lib/services/geo-search.service';
import { GOOGLE_MAPS_KEY, useGoogleMapsLoader } from '@/hooks/useGoogleMapsLoader';

type LocationSearchBoxProps = {
    /** Fired when the user picks a suggestion. */
    onSelect: (lat: number, lng: number, label: string) => void;
    placeholder?: string;
    /** Rank suggestions near this point first (e.g. the pin's current position). */
    biasLat?: number;
    biasLng?: number;
};

const newSessionToken = () =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

const MIN_CHARS = 2;
const DEBOUNCE_MS = 350;

type Bias = { lat: number; lng: number } | null;
type PickedPlace = { latitude: number; longitude: number; label: string };

/** Where suggestions and picked coordinates come from. */
type SearchProvider = {
    search: (q: string, bias: Bias) => Promise<GeoSearchResult[]>;
    /** Coordinates for a suggestion that carries only a placeId. */
    resolve: (r: GeoSearchResult) => Promise<PickedPlace>;
    /** Called after a pick: start a new billing session. */
    endSession: () => void;
};

/** Server-side search (/api/geo/*): Google Places (New) when the server key allows it, else OpenStreetMap. */
function useServerProvider(): SearchProvider {
    const sessionToken = useRef(newSessionToken());
    return {
        search: async (q, bias) => {
            const params = new URLSearchParams({ q, sessionToken: sessionToken.current });
            if (bias) {
                params.set('lat', String(bias.lat));
                params.set('lng', String(bias.lng));
            }
            const result = await apiClient.get<GeoSearchResult[]>(`/geo/search?${params.toString()}`);
            if (!result.success) throw new Error(result.error || 'Search failed');
            return result.data ?? [];
        },
        resolve: async (r) => {
            const params = new URLSearchParams({ placeId: r.placeId ?? r.id, sessionToken: sessionToken.current });
            const result = await apiClient.get<PickedPlace>(`/geo/place?${params.toString()}`);
            if (!result.success || !result.data) throw new Error(result.error || 'Could not get place location');
            return result.data;
        },
        endSession: () => {
            sessionToken.current = newSessionToken();
        },
    };
}

/**
 * Browser-side Google Places (Maps JavaScript API, `places` library): the same
 * suggestions Google Maps shows. Used when NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is
 * set: that key is enabled for the Maps JS Places service even where the
 * server-side Places API (New) is not. Any Google failure falls back to the
 * server provider so search never breaks.
 */
function useGoogleProvider(fallback: SearchProvider): SearchProvider {
    const { isLoaded, loadError } = useGoogleMapsLoader();
    const token = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
    const ready = isLoaded && !loadError;

    const session = () => (token.current ??= new google.maps.places.AutocompleteSessionToken());

    return {
        search: async (q, bias) => {
            if (!ready) return fallback.search(q, bias);
            try {
                return await new Promise<GeoSearchResult[]>((resolve, reject) => {
                    new google.maps.places.AutocompleteService().getPlacePredictions(
                        {
                            input: q,
                            sessionToken: session(),
                            componentRestrictions: { country: 'in' },
                            ...(bias ? { locationBias: { center: bias, radius: 50000 } } : {}),
                        },
                        (predictions, status) => {
                            const S = google.maps.places.PlacesServiceStatus;
                            if (status === S.ZERO_RESULTS) return resolve([]);
                            if (status !== S.OK || !predictions) return reject(new Error(String(status)));
                            resolve(
                                predictions.map((p) => ({
                                    id: p.place_id,
                                    placeId: p.place_id,
                                    label: p.structured_formatting?.main_text || p.description,
                                    secondary: p.structured_formatting?.secondary_text,
                                    latitude: null,
                                    longitude: null,
                                }))
                            );
                        }
                    );
                });
            } catch {
                return fallback.search(q, bias);
            }
        },
        resolve: async (r) => {
            if (!ready || !r.placeId) return fallback.resolve(r);
            return new Promise<PickedPlace>((resolve, reject) => {
                new google.maps.places.PlacesService(document.createElement('div')).getDetails(
                    {
                        placeId: r.placeId!,
                        fields: ['geometry', 'formatted_address', 'name'],
                        sessionToken: session(),
                    },
                    (place, status) => {
                        const loc = place?.geometry?.location;
                        if (status !== google.maps.places.PlacesServiceStatus.OK || !loc) {
                            return reject(new Error('Could not get place location'));
                        }
                        resolve({
                            latitude: loc.lat(),
                            longitude: loc.lng(),
                            label: place?.formatted_address || place?.name || r.label,
                        });
                    }
                );
            });
        },
        endSession: () => {
            token.current = null;
            fallback.endSession();
        },
    };
}

/**
 * Google-Maps-style type-ahead place search for the location pickers.
 * Suggestions appear while typing (debounced); arrow keys + Enter or a click picks one.
 * Uses Google Places in the browser when the Maps key is configured, else the server search.
 */
export default function LocationSearchBox(props: LocationSearchBoxProps) {
    return GOOGLE_MAPS_KEY ? <GoogleLocationSearchBox {...props} /> : <ServerLocationSearchBox {...props} />;
}

function ServerLocationSearchBox(props: LocationSearchBoxProps) {
    return <SearchBoxUI {...props} provider={useServerProvider()} />;
}

function GoogleLocationSearchBox(props: LocationSearchBoxProps) {
    const server = useServerProvider();
    return <SearchBoxUI {...props} provider={useGoogleProvider(server)} />;
}

function SearchBoxUI({ onSelect, placeholder, biasLat, biasLng, provider }: LocationSearchBoxProps & { provider: SearchProvider }) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<GeoSearchResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [activeIndex, setActiveIndex] = useState(-1);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const { toast } = useToast();
    // Each keystroke bumps this; responses from older requests are discarded so a slow
    // earlier reply can't overwrite suggestions for what the user has typed since.
    const requestSeq = useRef(0);
    // Set after picking a suggestion so filling the box with its label doesn't re-search
    const skipNextSearch = useRef(false);
    // Read the bias and provider via refs so moving the pin (or the Google script
    // finishing loading) doesn't re-trigger a search
    const biasRef = useRef<{ lat?: number; lng?: number }>({});
    biasRef.current = { lat: biasLat, lng: biasLng };
    const providerRef = useRef(provider);
    providerRef.current = provider;

    useEffect(() => {
        if (skipNextSearch.current) {
            skipNextSearch.current = false;
            return;
        }
        const q = query.trim();
        const seq = ++requestSeq.current;
        if (q.length < MIN_CHARS) {
            setResults([]);
            setIsOpen(false);
            setIsSearching(false);
            return;
        }
        const timer = setTimeout(async () => {
            setIsSearching(true);
            setError(null);
            try {
                const { lat, lng } = biasRef.current;
                const bias =
                    lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
                const found = await providerRef.current.search(q, bias);
                if (seq !== requestSeq.current) return;
                setResults(found);
            } catch (err) {
                if (seq !== requestSeq.current) return;
                setResults([]);
                setError(err instanceof Error ? err.message : 'Failed to search location');
            } finally {
                if (seq === requestSeq.current) {
                    setIsSearching(false);
                    setActiveIndex(-1);
                    setIsOpen(true);
                }
            }
        }, DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [query]);

    // Close the dropdown when clicking anywhere outside the box
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) setIsOpen(false);
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const handlePick = async (r: GeoSearchResult) => {
        skipNextSearch.current = true;
        requestSeq.current++;
        const fullLabel = r.secondary ? `${r.label}, ${r.secondary}` : r.label;
        setQuery(fullLabel);
        setIsOpen(false);
        setResults([]);

        if (r.latitude != null && r.longitude != null) {
            onSelect(r.latitude, r.longitude, fullLabel);
            return;
        }
        // Google suggestions carry only a placeId — fetch its coordinates
        setIsSearching(true);
        try {
            const place = await provider.resolve(r);
            onSelect(place.latitude, place.longitude, place.label || fullLabel);
        } catch (err) {
            toast({
                title: 'Location Error',
                description: err instanceof Error ? err.message : 'Could not get place location',
                variant: 'destructive',
            });
        } finally {
            setIsSearching(false);
            provider.endSession();
        }
    };

    const handleClear = () => {
        setQuery('');
        setResults([]);
        setIsOpen(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'ArrowDown' && results.length) {
            e.preventDefault();
            setIsOpen(true);
            setActiveIndex((i) => (i + 1) % results.length);
        } else if (e.key === 'ArrowUp' && results.length) {
            e.preventDefault();
            setActiveIndex((i) => (i <= 0 ? results.length - 1 : i - 1));
        } else if (e.key === 'Enter') {
            // The picker lives near/inside a <form> — Enter must pick, never submit it
            e.preventDefault();
            const pick = results[activeIndex >= 0 ? activeIndex : 0];
            if (isOpen && pick) handlePick(pick);
        } else if (e.key === 'Escape') {
            setIsOpen(false);
        }
    };

    return (
        <div ref={containerRef} className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => {
                    if (results.length) setIsOpen(true);
                }}
                placeholder={placeholder || 'Search place, street, town or pincode…'}
                className="h-10 pl-9 pr-9"
                autoComplete="off"
                role="combobox"
                aria-expanded={isOpen}
                aria-autocomplete="list"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
                {isSearching ? (
                    <Loader2 className="h-4 w-4 animate-spin text-primary" />
                ) : (
                    query && (
                        <button type="button" onClick={handleClear} aria-label="Clear search" className="text-muted-foreground hover:text-foreground">
                            <X className="h-4 w-4" />
                        </button>
                    )
                )}
            </div>

            {isOpen && (
                <div
                    role="listbox"
                    className="absolute left-0 right-0 top-full z-[1100] mt-1 max-h-72 overflow-y-auto rounded-lg border bg-white shadow-lg dark:bg-brand-green-darker"
                >
                    {error ? (
                        <p className="px-3 py-2 text-sm text-red-600">{error}</p>
                    ) : results.length === 0 ? (
                        <p className="px-3 py-2 text-sm text-muted-foreground">No locations found.</p>
                    ) : (
                        results.map((r, i) => (
                            <button
                                key={r.id}
                                type="button"
                                role="option"
                                aria-selected={i === activeIndex}
                                onMouseEnter={() => setActiveIndex(i)}
                                onClick={() => handlePick(r)}
                                className={cn(
                                    'flex w-full items-start gap-2 px-3 py-2 text-left text-sm',
                                    i === activeIndex ? 'bg-green-50 dark:bg-sidebar-accent' : 'hover:bg-green-50 dark:hover:bg-sidebar-accent'
                                )}
                            >
                                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                                <span>
                                    <span className="font-medium">{r.label}</span>
                                    {r.secondary && <span className="text-muted-foreground"> {r.secondary}</span>}
                                </span>
                            </button>
                        ))
                    )}
                </div>
            )}
        </div>
    );
}
