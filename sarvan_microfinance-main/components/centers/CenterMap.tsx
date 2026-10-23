'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { CircleF, GoogleMap, InfoWindowF, MarkerF } from '@react-google-maps/api';
import { useLastGpsFix } from '@/hooks/useAccurateLocation';
import { GOOGLE_MAPS_KEY, useGoogleMapsLoader } from '@/hooks/useGoogleMapsLoader';
import LocationSearchBox from './LocationSearchBox';
import type { CenterMapProps } from './CenterMapLeaflet';

/**
 * Location map used by every lat/long picker and preview — Branch and Center
 * create/edit, Member Enrollment (LocationPickerDialog / LocationPreview),
 * Member Individual House Hold Visit, the Locate / Location Approval views.
 *
 * Renders Google Maps (satellite/hybrid available, draggable pin, click to
 * place) when NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is configured (shared loader:
 * hooks/useGoogleMapsLoader.ts). Without a key it falls back
 * to the OpenStreetMap/Leaflet map (CenterMapLeaflet) so pickers never break.
 * The props are identical either way.
 */

const LeafletMap = dynamic(() => import('./CenterMapLeaflet'), { ssr: false });

export default function CenterMap(props: CenterMapProps) {
    if (!GOOGLE_MAPS_KEY) return <LeafletMap {...props} />;
    return <GoogleCenterMap {...props} />;
}

function GoogleCenterMap({
    latitude,
    longitude,
    centerName,
    centerCode,
    address,
    editable = false,
    onLocationChange,
    heightClassName = 'h-[75vh]',
    searchable,
}: CenterMapProps) {
    const { isLoaded, loadError } = useGoogleMapsLoader();
    const mapRef = useRef<google.maps.Map | null>(null);
    const [infoOpen, setInfoOpen] = useState(false);
    const showSearch = (searchable ?? editable) && !!onLocationChange;
    const canMove = editable && !!onLocationChange;

    const position = useMemo(() => ({ lat: latitude, lng: longitude }), [latitude, longitude]);

    // Like Google Maps' blue accuracy circle: shown while the pin still sits on
    // the last "Use My Location" fix (forms round to 6 decimals, ~0.1 m, so
    // compare within ~1 m); gone once the pin is dragged or a place searched.
    const gpsFix = useLastGpsFix();
    const showAccuracy =
        !!gpsFix &&
        Math.abs(gpsFix.latitude - latitude) < 1e-5 &&
        Math.abs(gpsFix.longitude - longitude) < 1e-5;
    // Initial view only; later coordinate changes pan (below) without resetting zoom.
    const [initialCenter] = useState(position);

    useEffect(() => {
        mapRef.current?.panTo(position);
    }, [position]);

    const onLoad = useCallback((map: google.maps.Map) => {
        mapRef.current = map;
    }, []);

    const place = useCallback(
        (e: google.maps.MapMouseEvent) => {
            if (!canMove || !e.latLng) return;
            onLocationChange!(e.latLng.lat(), e.latLng.lng());
        },
        [canMove, onLocationChange]
    );

    return (
        <div className="space-y-2">
            {showSearch && onLocationChange && (
                <LocationSearchBox
                    onSelect={(lat, lng) => onLocationChange(lat, lng)}
                    biasLat={latitude}
                    biasLng={longitude}
                />
            )}
            <div className={`${heightClassName} w-full rounded-lg overflow-hidden border`}>
                {loadError ? (
                    // Key present but the script failed (bad key, blocked, offline) — keep the picker usable.
                    <LeafletMap
                        latitude={latitude}
                        longitude={longitude}
                        centerName={centerName}
                        centerCode={centerCode}
                        address={address}
                        editable={editable}
                        onLocationChange={onLocationChange}
                        heightClassName="h-full"
                        searchable={false}
                    />
                ) : !isLoaded ? (
                    <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                        Loading map...
                    </div>
                ) : (
                    <GoogleMap
                        mapContainerStyle={{ height: '100%', width: '100%' }}
                        center={initialCenter}
                        zoom={15}
                        onLoad={onLoad}
                        onClick={place}
                        options={{
                            mapTypeControl: true,
                            mapTypeControlOptions: { mapTypeIds: ['roadmap', 'hybrid'] },
                            streetViewControl: false,
                            fullscreenControl: true,
                            gestureHandling: 'greedy',
                            clickableIcons: false,
                        }}
                    >
                        {showAccuracy && gpsFix && (
                            <CircleF
                                center={position}
                                radius={gpsFix.accuracy}
                                options={{
                                    fillColor: '#4285F4',
                                    fillOpacity: 0.15,
                                    strokeColor: '#4285F4',
                                    strokeOpacity: 0.5,
                                    strokeWeight: 1,
                                    clickable: false,
                                }}
                            />
                        )}
                        <MarkerF
                            position={position}
                            draggable={canMove}
                            onDragEnd={place}
                            onClick={() => setInfoOpen((o) => !o)}
                        />
                        {infoOpen && (
                            <InfoWindowF position={position} onCloseClick={() => setInfoOpen(false)}>
                                <div className="space-y-1 text-black">
                                    <h3 className="font-semibold">{centerName}</h3>
                                    <p className="text-sm">Code: {centerCode}</p>
                                    {address && <p className="text-sm">Address: {address}</p>}
                                    <p className="text-xs">
                                        Coordinates: {latitude.toFixed(6)}, {longitude.toFixed(6)}
                                    </p>
                                    {showAccuracy && gpsFix && (
                                        <p className="text-xs">Device location accuracy: ±{Math.round(gpsFix.accuracy)} m</p>
                                    )}
                                    {canMove && (
                                        <p className="text-xs font-medium text-green-700">
                                            Drag marker or click map to reposition
                                        </p>
                                    )}
                                </div>
                            </InfoWindowF>
                        )}
                    </GoogleMap>
                )}
            </div>
        </div>
    );
}
