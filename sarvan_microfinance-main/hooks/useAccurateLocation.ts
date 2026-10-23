'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';
import { useToast } from '@/hooks/use-toast';
import {
    getAccurateCurrentPosition,
    gpsErrorMessage,
    type AccuratePosition,
} from '@/app/lib/location-utils';

// Above this the fix is approximate (Wi-Fi/cell based: laptop, indoors). Normal
// for a device without GPS, so it is reported neutrally, like Google Maps does,
// with the accuracy circle drawn on the map instead of an error.
export const LOW_ACCURACY_WARN_METERS = 100;
// Above this the fix is genuinely unreliable (IP/cell-tower level).
export const UNRELIABLE_ACCURACY_METERS = 1000;

// ── Last "Use My Location" fix, shared with the location maps ────────────────
// CenterMap draws the blue dot + accuracy circle while its pin still sits on
// this fix (cleared visually as soon as the pin is dragged or a place searched).
let lastFix: AccuratePosition | null = null;
const listeners = new Set<() => void>();
function setLastGpsFix(fix: AccuratePosition | null) {
    lastFix = fix;
    listeners.forEach((l) => l());
}
/** The most recent device location fix (with its accuracy), or null. */
export function useLastGpsFix(): AccuratePosition | null {
    return useSyncExternalStore(
        (cb) => {
            listeners.add(cb);
            return () => listeners.delete(cb);
        },
        () => lastFix,
        () => null
    );
}

type LocateOptions = {
    /** Called with each better reading while sampling, and with the final one. */
    onPosition: (lat: number, lng: number) => void;
    /** Called once with the final (best) reading. */
    onDone?: (pos: AccuratePosition) => void;
    /** Shown in the success toast, e.g. "Center". */
    subject?: string;
    /** Handle errors yourself (e.g. inline message) instead of an error toast. */
    onError?: (message: string) => void;
    /** Skip the success / low-accuracy toasts. */
    silent?: boolean;
    /**
     * Call onPosition for every improving reading (default) — set false when each
     * update is expensive (e.g. triggers distance API calls); onPosition then fires
     * once with the final fix.
     */
    liveUpdates?: boolean;
};

/**
 * "Use My Location" with real accuracy: samples high-accuracy GPS readings
 * (no cached fix) and keeps the best one instead of taking the browser's first,
 * often Wi-Fi/IP-based guess. Exposes live progress for the button label.
 */
export function useAccurateLocation(targetAccuracyMeters = 20, maxWaitMs = 20000) {
    const { toast } = useToast();
    const [isLocating, setIsLocating] = useState(false);
    // Best accuracy (meters) seen so far while sampling — null when idle
    const [accuracy, setAccuracy] = useState<number | null>(null);

    const locate = useCallback(
        async ({ onPosition, onDone, subject = 'Location', onError, silent, liveUpdates = true }: LocateOptions) => {
            const fail = (message: string) => {
                if (onError) onError(message);
                else toast({ title: 'Location Error', description: message, variant: 'destructive' });
            };
            if (typeof navigator === 'undefined' || !navigator.geolocation) {
                fail('Geolocation is not supported by your browser.');
                return null;
            }
            setIsLocating(true);
            setAccuracy(null);
            try {
                const pos = await getAccurateCurrentPosition({
                    targetAccuracyMeters,
                    maxWaitMs,
                    onProgress: (best) => {
                        setAccuracy(best.accuracy);
                        setLastGpsFix(best);
                        if (liveUpdates) onPosition(best.latitude, best.longitude);
                    },
                });
                setLastGpsFix(pos);
                onPosition(pos.latitude, pos.longitude);
                onDone?.(pos);
                if (!silent) {
                    const meters = Math.round(pos.accuracy);
                    if (pos.accuracy > UNRELIABLE_ACCURACY_METERS) {
                        toast({
                            title: 'Low Location Accuracy',
                            description: `Location is only accurate to about ±${meters} m. Please search the exact place or drag the pin onto it on the map.`,
                            variant: 'destructive',
                        });
                    } else if (pos.accuracy > LOW_ACCURACY_WARN_METERS) {
                        toast({
                            title: 'Approximate Location',
                            description: `${subject} set from your current position, accurate to about ±${meters} m (shaded circle on the map). Drag the pin onto the exact spot if needed.`,
                        });
                    } else {
                        toast({
                            title: 'Location Captured',
                            description: `${subject} set from your current position (accurate to ±${meters} m).`,
                        });
                    }
                }
                return pos;
            } catch (error) {
                console.error('Geolocation error:', error);
                fail(
                    typeof GeolocationPositionError !== 'undefined' && error instanceof GeolocationPositionError
                        ? gpsErrorMessage(error)
                        : error instanceof Error
                            ? error.message
                            : 'Could not get your location. Please try again or check browser permissions.'
                );
                return null;
            } finally {
                setIsLocating(false);
                setAccuracy(null);
            }
        },
        [toast, targetAccuracyMeters, maxWaitMs]
    );

    /** Button label while locating, e.g. "Improving accuracy… ±45 m". */
    const locatingLabel = accuracy != null ? `Improving accuracy… ±${Math.round(accuracy)} m` : 'Locating...';

    return { locate, isLocating, accuracy, locatingLabel };
}
