'use client';

import dynamic from 'next/dynamic';
import { Loader2, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';

// Leaflet touches `window`, so it must be loaded client-side only
const MapComponent = dynamic(() => import('./CenterMap'), {
    ssr: false,
    loading: () => (
        <div className="flex h-full min-h-40 items-center justify-center rounded-lg border">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </div>
    ),
});

type LocationPreviewProps = {
    latitude?: number | string | null;
    longitude?: number | string | null;
    /** Marker popup title (e.g. center / member name). */
    title?: string;
    /** Marker popup code line. */
    code?: string;
    address?: string;
    /** Tailwind height class. Defaults to h-56. */
    heightClassName?: string;
    /** Hide the "no location yet" placeholder when coordinates are missing. */
    hideWhenEmpty?: boolean;
    emptyText?: string;
    className?: string;
};

const toCoord = (v: number | string | null | undefined): number =>
    typeof v === 'number' ? v : parseFloat(v ?? '');

/**
 * Read-only map preview of a captured location. Renders a placeholder until both
 * coordinates are valid, so it can sit under lat/long inputs and update live.
 */
export default function LocationPreview({
    latitude,
    longitude,
    title,
    code,
    address,
    heightClassName = 'h-56',
    hideWhenEmpty = false,
    emptyText = 'Capture or select a location to preview it on the map',
    className,
}: LocationPreviewProps) {
    const lat = toCoord(latitude);
    const lng = toCoord(longitude);
    const valid = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

    if (!valid) {
        if (hideWhenEmpty) return null;
        return (
            <div
                className={cn(
                    'flex h-20 items-center justify-center rounded-lg border border-dashed border-primary/30 px-3 text-center text-sm text-sidebar-accent dark:text-slate-400',
                    className
                )}
            >
                <MapPin className="mr-2 h-4 w-4 shrink-0" />
                {emptyText}
            </div>
        );
    }

    return (
        <div className={className}>
            <MapComponent
                latitude={lat}
                longitude={lng}
                centerName={title || 'Location'}
                centerCode={code || ''}
                address={address}
                heightClassName={heightClassName}
            />
        </div>
    );
}
