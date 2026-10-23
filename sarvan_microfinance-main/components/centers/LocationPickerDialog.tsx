'use client';

import dynamic from 'next/dynamic';
import { Loader2, MapPin } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';

// Leaflet touches `window`, so it must be loaded client-side only
const MapComponent = dynamic(() => import('./CenterMap'), {
    ssr: false,
    loading: () => (
        <div className="flex h-[50vh] items-center justify-center rounded-lg border">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
    ),
});

// Same fallback the Branch / Center forms use when no location is set yet
const DEFAULT_MAP_LAT = 10.3624;
const DEFAULT_MAP_LNG = 77.9695;

type LocationPickerDialogProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    latitude?: number | string | null;
    longitude?: number | string | null;
    /** Fallback map centre when no coordinates are set yet (e.g. the center's location). */
    fallbackLatitude?: number | null;
    fallbackLongitude?: number | null;
    title?: string;
    description?: string;
    markerTitle?: string;
    markerCode?: string;
    onLocationChange: (lat: number, lng: number) => void;
};

const toCoord = (v: number | string | null | undefined): number =>
    typeof v === 'number' ? v : parseFloat(v ?? '');

/** Map picker dialog: search a place, click the map, or drag the marker. */
export default function LocationPickerDialog({
    open,
    onOpenChange,
    latitude,
    longitude,
    fallbackLatitude,
    fallbackLongitude,
    title = 'Select Location',
    description = 'Search for a place, click anywhere on the map, or drag the marker to set the latitude and longitude.',
    markerTitle = 'Selected Location',
    markerCode = '',
    onLocationChange,
}: LocationPickerDialogProps) {
    const lat = toCoord(latitude);
    const lng = toCoord(longitude);
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-3xl">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <MapPin className="h-5 w-5 text-primary" />
                        {title}
                    </DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>
                {open && (
                    <MapComponent
                        latitude={hasCoords ? lat : fallbackLatitude ?? DEFAULT_MAP_LAT}
                        longitude={hasCoords ? lng : fallbackLongitude ?? DEFAULT_MAP_LNG}
                        centerName={markerTitle}
                        centerCode={markerCode}
                        editable
                        onLocationChange={onLocationChange}
                        heightClassName="h-[50vh]"
                    />
                )}
                <DialogFooter>
                    <Button type="button" onClick={() => onOpenChange(false)} className="bg-primary hover:bg-sidebar-accent text-white">
                        Done
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
