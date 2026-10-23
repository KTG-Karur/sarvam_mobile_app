'use client';

import { MapPin, ExternalLink } from 'lucide-react';
import { QRCodeCanvas } from 'qrcode.react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export type RevertLocationDto = { latitude: number; longitude: number } | null | undefined;

// Same URL format the member enrollment Location QR encodes.
export const revertMapsUrl = (loc: { latitude: number; longitude: number }) =>
    `https://www.google.com/maps?q=${loc.latitude.toFixed(6)},${loc.longitude.toFixed(6)}`;

/** Revert-history cell: lat/long, with a popover holding the Google Maps QR + link. "—" for older reverts with no location. */
export function RevertLocationCell({ location }: { location: RevertLocationDto }) {
    if (!location) return <span className="text-muted-foreground">—</span>;
    const url = revertMapsUrl(location);
    return (
        <Popover>
            <PopoverTrigger asChild>
                <button
                    type="button"
                    title="Show location QR"
                    className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-primary underline-offset-2 hover:underline"
                >
                    <MapPin className="h-3 w-3 shrink-0" />
                    {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
                </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto space-y-2 p-3" align="start">
                <QRCodeCanvas value={url} size={140} includeMargin />
                <p className="max-w-[160px] text-[11px] text-muted-foreground">Scan to open the revert location in Google Maps.</p>
                <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                >
                    <ExternalLink className="h-3 w-3" /> Open in Google Maps
                </a>
            </PopoverContent>
        </Popover>
    );
}
