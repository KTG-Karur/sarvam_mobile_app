'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/app/lib/api-client';

export interface DrivingDistanceState {
    distanceMeters: number | null;
    source: 'osrm' | 'straight-line' | null;
    isLoading: boolean;
}

/**
 * Client-side road (driving) distance between two points — the same OSRM-backed
 * calculation Create Center uses for "KM From Branch", used here in place of a
 * straight-line haversine estimate. Falls back silently to whatever the
 * `/geo/driving-distance` endpoint returns (it self-falls-back to straight-line
 * server-side if OSRM is unreachable).
 */
export function useDrivingDistance(
    fromLat: number | null | undefined,
    fromLng: number | null | undefined,
    toLat: number | null | undefined,
    toLng: number | null | undefined,
): DrivingDistanceState {
    const [state, setState] = useState<DrivingDistanceState>({ distanceMeters: null, source: null, isLoading: false });

    useEffect(() => {
        if (fromLat == null || fromLng == null || toLat == null || toLng == null ||
            !Number.isFinite(fromLat) || !Number.isFinite(fromLng) || !Number.isFinite(toLat) || !Number.isFinite(toLng)) {
            setState({ distanceMeters: null, source: null, isLoading: false });
            return;
        }
        let cancelled = false;
        setState((s) => ({ ...s, isLoading: true }));
        apiClient
            .get<{ distanceKm: number; source: 'osrm' | 'straight-line' }>(
                `/geo/driving-distance?fromLat=${fromLat}&fromLng=${fromLng}&toLat=${toLat}&toLng=${toLng}`
            )
            .then((res) => {
                if (cancelled) return;
                if (res.success && res.data) {
                    setState({ distanceMeters: res.data.distanceKm * 1000, source: res.data.source, isLoading: false });
                } else {
                    setState({ distanceMeters: null, source: null, isLoading: false });
                }
            })
            .catch(() => {
                if (!cancelled) setState({ distanceMeters: null, source: null, isLoading: false });
            });
        return () => { cancelled = true; };
    }, [fromLat, fromLng, toLat, toLng]);

    return state;
}
