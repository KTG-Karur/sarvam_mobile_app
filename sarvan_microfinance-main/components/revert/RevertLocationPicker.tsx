'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, LocateFixed, MapPin, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { useAccurateLocation, LOW_ACCURACY_WARN_METERS } from '@/hooks/useAccurateLocation';
import LocationPreview from '@/components/centers/LocationPreview';

export type RevertLocationValue = { latitude: number; longitude: number };

interface RevertLocationPickerProps {
    value: RevertLocationValue | null;
    onChange: (value: RevertLocationValue | null) => void;
    /** Fetch the device location on mount (each time the picker is shown). */
    autoLocate?: boolean;
    disabled?: boolean;
}

/**
 * Mandatory location capture for every revert: the device GPS only ("Use My Location"),
 * no search, map pin or manual entry — so the stored location is where the user actually
 * is. The parent keeps its Revert button disabled until `value` is set.
 */
export function RevertLocationPicker({ value, onChange, autoLocate = true, disabled }: RevertLocationPickerProps) {
    const { locate, isLocating, locatingLabel } = useAccurateLocation();
    const [accuracy, setAccuracy] = useState<number | null>(null);
    const [error, setError] = useState('');

    const fetchLocation = useCallback(() => {
        setError('');
        locate({
            onPosition: (lat, lng) => onChange({ latitude: lat, longitude: lng }),
            onDone: (pos) => setAccuracy(pos.accuracy),
            onError: setError,
            silent: true,
            liveUpdates: false,
        });
    }, [locate, onChange]);

    useEffect(() => {
        if (autoLocate && !value) fetchLocation();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div className="space-y-2 rounded-lg border border-primary/20 bg-muted/30 p-3">
            <div className="flex items-center justify-between gap-2">
                <Label className="flex items-center gap-1.5 text-sm font-semibold">
                    <MapPin className="h-4 w-4 text-primary" /> Your location <span className="text-red-500">*</span>
                </Label>
                <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={disabled || isLocating} onClick={fetchLocation}>
                    {isLocating ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <LocateFixed className="mr-1 h-3 w-3" />}
                    {isLocating ? locatingLabel : 'Use My Location'}
                </Button>
            </div>

            {value && (
                <p className="text-xs text-muted-foreground">
                    {value.latitude.toFixed(6)}, {value.longitude.toFixed(6)}
                </p>
            )}
            {accuracy != null && (
                <p className={`flex items-center gap-1.5 text-[11px] ${accuracy > LOW_ACCURACY_WARN_METERS ? 'text-amber-600' : 'text-emerald-600'}`}>
                    <LocateFixed className="h-3 w-3 shrink-0" />
                    GPS accuracy ±{Math.round(accuracy)} m
                    {accuracy > LOW_ACCURACY_WARN_METERS && ' — approximate (no GPS / indoors)'}
                </p>
            )}
            {error && (
                <p className="flex items-center gap-1.5 text-[11px] text-red-600">
                    <AlertTriangle className="h-3 w-3 shrink-0" /> {error}
                </p>
            )}
            {!value && !isLocating && !error && (
                <p className="text-[11px] text-amber-600">Location is required before you can revert. Tap "Use My Location".</p>
            )}

            <LocationPreview latitude={value?.latitude} longitude={value?.longitude} title="Revert location" heightClassName="h-36" hideWhenEmpty />
        </div>
    );
}
